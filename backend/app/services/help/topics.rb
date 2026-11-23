module Help
  # The Help page's topics, written in config/help_topics.yml (English). Each topic:
  #   key, title, category, summary
  #   access    all (every signed-in user), admin, or a section (User::SECTIONS: dashboard, orders, …) the user needs
  #   hide_for  roles that never see it (e.g. warehouse_manager: they cannot upload order files)
  #   sections  [{ heading, text, steps (numbered), bullets, table: { columns, rows } }] in reading order; a step is its
  #             text, or { text, image (a screenshot: public/help/<image>.jpg), page (the app page it happens on) }
  #   messages  [{ message, meaning }]: messages the app can show, and what to do
  #   video     what the topic's video shows (its file: public/help/videos/<key>.mp4)
  # The page (Api::HelpController#index) and the PDF (Help::PdfBuilder) both read them, so they always say the same.
  module Topics
    FILE = Rails.root.join("config/help_topics.yml")
    IMAGES = Rails.root.join("public/help")
    VIDEOS = Rails.root.join("public/help/videos")
    ACCESS = ([ "all", "admin" ] + User::SECTIONS).freeze

    module_function

    def all
      return load_file if Rails.env.development? # edits show without a restart

      @all ||= load_file
    end

    def visible_to(user)
      all.select { |topic| visible?(topic, user) }
    end

    def visible?(topic, user)
      return false if Array(topic[:hide_for]).include?(user.role)

      case topic[:access]
      when "all" then true
      when "admin" then user.admin?
      else user.can?(topic[:access])
      end
    end

    # The topic `key` if `user` may see it, else nil.
    def find(key, user)
      topic = all.find { |t| t[:key] == key.to_s }
      topic if topic && visible?(topic, user)
    end

    # The topic's video file (public/help/videos/<key>.mp4), or nil.
    def video_path(key)
      path = VIDEOS.join("#{key}.mp4")
      path if key.to_s.match?(/\A[a-z0-9-]+\z/) && File.file?(path)
    end

    def load_file
      topics = YAML.safe_load_file(FILE).map(&:deep_symbolize_keys)
      topics.each do |t|
        raise ArgumentError, "Help topic #{t[:key].inspect}: access #{t[:access].inspect} is not one of #{ACCESS.join(', ')}" unless ACCESS.include?(t[:access])
      end
      raise ArgumentError, "Help topics: duplicate keys" if topics.map { |t| t[:key] }.uniq.size != topics.size

      topics.freeze
    end
  end
end
