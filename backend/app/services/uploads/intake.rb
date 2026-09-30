require "digest"

module Uploads
  # Accepts an uploaded file from the request: validates it, stores the original permanently and
  # creates a pending UploadBatch. Parsing happens later in Uploads::ProcessJob.
  class Intake
    XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet".freeze
    ZIP_SIGNATURE = "PK\x03\x04".b.freeze

    class Rejected < StandardError; end

    def self.call(file:, user:)
      new(file, user).call
    end

    def initialize(file, user)
      @file = file
      @user = user
    end

    def call
      validate!
      filename = ActiveStorage::Filename.new(@file.original_filename.to_s).sanitized.first(255)
      sha256 = Digest::SHA256.file(@file.path).hexdigest

      blob = ActiveStorage::Blob.create_and_upload!(
        io: File.open(@file.path, "rb"), filename: filename, content_type: XLSX_CONTENT_TYPE, identify: false
      )
      batch = UploadBatch.create!(
        uploaded_by: @user, status: "pending", original_filename: filename, file_sha256: sha256,
        byte_size: blob.byte_size, content_type: XLSX_CONTENT_TYPE, file: blob
      )
      Uploads::ProcessJob.perform_later(batch.id)
      batch
    end

    private

    # The browser-supplied content type is not trusted; extension, size and file signature are checked here,
    # and the workbook structure is fully validated during processing.
    def validate!
      raise Rejected, "Choose an Excel file to upload." unless @file.respond_to?(:path) && @file.respond_to?(:original_filename)
      raise Rejected, "Only Excel .xlsx files are accepted." unless File.extname(@file.original_filename.to_s).casecmp?(".xlsx")
      size = File.size(@file.path)
      raise Rejected, "The file is empty." if size.zero?
      if size > AppConfig.max_upload_bytes
        raise Rejected, "The file is larger than #{AppConfig.max_upload_bytes / 1.megabyte} MB."
      end
      signature = File.binread(@file.path, 4)
      raise Rejected, "The file is not a valid .xlsx workbook." unless signature == ZIP_SIGNATURE
    end
  end
end
