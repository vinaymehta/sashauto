module Api
  # The Help page: the topics the user may see (Help::Topics, config/help_topics.yml), each as a PDF, and each topic's
  # video (shipped with the app in public/help/videos, or uploaded as a HelpVideo, which then comes first; the page has
  # no upload buttons, the upload and remove endpoints stay). Every signed-in user reads the topics of the sections they have; admins upload, replace and remove
  # the videos. Videos are served here in ranges (the browser's player asks for parts as it plays), never from a public
  # link.
  class HelpController < ApplicationController
    before_action :load_topic, except: %i[index image]
    before_action -> { require_role(:admin) }, only: %i[upload_video remove_video]

    # Largest part of a video sent for an open-ended range (bytes=N-): the player asks again for the rest.
    CHUNK = 2.megabytes

    def index
      topics = Help::Topics.visible_to(current_user)
      videos = HelpVideo.where(topic: topics.map { |t| t[:key] }).includes(:uploaded_by, file_attachment: :blob).index_by(&:topic)
      admin = current_user.admin?
      render json: { data: topics.map { |t| topic_json(t, videos[t[:key]], admin) }, can_manage_videos: admin,
                     max_video_mb: HelpVideo::MAX_BYTES / 1.megabyte }
    end

    # A step's screenshot (public/help/<name>.jpg, named in config/help_topics.yml): for signed-in users only.
    def image
      name = params[:name].to_s
      path = Help::Topics::IMAGES.join("#{name}.jpg")
      return render_error("Not found.", :not_found) unless name.match?(/\A[a-z0-9-]+\z/) && File.file?(path)

      expires_in 1.day, private: true
      send_file path, type: "image/jpeg", disposition: "inline"
    end

    # Captions of the topic's bundled video (the narration as WebVTT text, for the player's CC button).
    def captions
      path = Help::Topics.captions_path(@topic[:key]) or return render_error("Not found.", :not_found)

      expires_in 1.day, private: true
      send_file path, type: "text/vtt", disposition: "inline"
    end

    def pdf
      expires_in 0, private: true
      send_data Help::PdfBuilder.new(@topic).render, filename: "SASH Help - #{@topic[:title].tr('/', '-')}.pdf", type: "application/pdf",
                                                     disposition: params[:download] == "1" ? "attachment" : "inline"
    end

    # The topic's uploaded video, else the one shipped with the app (public/help/videos/<topic>.mp4).
    def video
      blob = HelpVideo.find_by(topic: @topic[:key])&.file&.blob
      return bundled_video unless blob

      response.headers["Accept-Ranges"] = "bytes"
      range = byte_range(request.headers["Range"], blob.byte_size)
      return head(:range_not_satisfiable, "Content-Range" => "bytes */#{blob.byte_size}") if range == :invalid

      expires_in 1.hour, private: true
      if range
        response.headers["Content-Range"] = "bytes #{range.begin}-#{range.end}/#{blob.byte_size}"
        send_data blob.download_chunk(range), type: blob.content_type, disposition: "inline", status: :partial_content
      else
        send_data blob.download, type: blob.content_type, disposition: "inline", filename: blob.filename.to_s
      end
    end

    # POST multipart `file` (MP4, WebM or MOV, up to HelpVideo::MAX_BYTES): the topic's video, replacing any earlier one.
    def upload_video
      file = params[:file]
      return render_error("Choose a video file.", :unprocessable_content) unless file.respond_to?(:path)
      if File.size(file.path) > HelpVideo::MAX_BYTES
        return render_error("The video is larger than #{HelpVideo::MAX_BYTES / 1.megabyte} MB. Record it shorter or at a lower resolution.", :unprocessable_content)
      end

      blob = ActiveStorage::Blob.create_and_upload!(io: File.open(file.path, "rb"), identify: true,
                                                    filename: ActiveStorage::Filename.new(file.original_filename.to_s).sanitized)
      unless HelpVideo::TYPES.include?(blob.content_type)
        blob.purge
        return render_error("#{blob.filename} is not an MP4, WebM or MOV video.", :unprocessable_content)
      end

      video = HelpVideo.find_or_initialize_by(topic: @topic[:key])
      old = video.file.attached? ? video.file.blob : nil
      video.update!(title: params[:title].to_s.squish.first(200).presence, uploaded_by: current_user)
      video.file.attach(blob)
      old&.purge_later
      audit("help.video_uploaded", subject: video, topic: @topic[:key], file: blob.filename.to_s)
      render json: { data: video_json(video.reload) }, status: :created
    end

    def remove_video
      video = HelpVideo.find_by(topic: @topic[:key]) or return head(:no_content)
      name = video.file.attached? ? video.file.filename.to_s : nil
      video.file.purge if video.file.attached?
      video.destroy!
      audit("help.video_removed", topic: @topic[:key], file: name)
      head :no_content
    end

    private

    # The video shipped with the app, in ranges as #video.
    def bundled_video
      path = Help::Topics.video_path(@topic[:key]) or return render_error("This topic has no video yet.", :not_found)
      size = File.size(path)
      response.headers["Accept-Ranges"] = "bytes"
      range = byte_range(request.headers["Range"], size)
      return head(:range_not_satisfiable, "Content-Range" => "bytes */#{size}") if range == :invalid

      expires_in 1.day, private: true
      if range
        response.headers["Content-Range"] = "bytes #{range.begin}-#{range.end}/#{size}"
        send_data File.open(path, "rb") { |f| f.seek(range.begin); f.read(range.size) }, type: "video/mp4", disposition: "inline", status: :partial_content
      else
        send_file path, type: "video/mp4", disposition: "inline"
      end
    end

    def load_topic
      @topic = Help::Topics.find(params[:topic], current_user) or render_error("Not found.", :not_found)
    end

    # The byte range a Range header asks for (nil: none, the whole file; :invalid: outside the file). An open end is
    # served in CHUNK parts.
    def byte_range(header, size)
      match = header.to_s.match(/\Abytes=(\d*)-(\d*)\z/) or return nil
      first, last = match[1], match[2]
      return nil if first.empty? && last.empty?

      if first.empty? # the last N bytes
        from = [ size - last.to_i, 0 ].max
        to = size - 1
      else
        from = first.to_i
        to = last.empty? ? [ from + CHUNK - 1, size - 1 ].min : [ last.to_i, size - 1 ].min
      end
      from <= to && from < size ? (from..to) : :invalid
    end

    def topic_json(topic, video, admin)
      json = topic.slice(:key, :title, :category, :summary, :sections, :messages, :access)
      path = Help::Topics.video_path(topic[:key])
      json[:video] = if video&.file&.attached? then video_json(video)
      elsif path then bundled_video_json(topic[:key], path)
      end
      json[:video_hint] = topic[:video] if admin
      json
    end

    # The bundled video, and its captions when it has them (an uploaded video has none: they would not match it).
    def bundled_video_json(key, path)
      captions = Help::Topics.captions_path(key)
      { url: "/api/help/#{key}/video?v=#{File.mtime(path).to_i}", size: File.size(path),
        captions: captions && "/api/help/#{key}/captions?v=#{File.mtime(captions).to_i}" }.compact
    end

    def video_json(video)
      blob = video.file.blob
      { title: video.title, filename: blob.filename.to_s, size: blob.byte_size, content_type: blob.content_type,
        uploaded_at: video.updated_at, uploaded_by: video.uploaded_by&.name, url: "/api/help/#{video.topic}/video?v=#{blob.id}" }
    end
  end
end
