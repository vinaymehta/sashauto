module Api
  # Photos of a part (Products → part panel → Images). Upload: POST multipart `files[]` (JPG, PNG, WebP or GIF, each up
  # to MAX_BYTES, at most Product::MAX_IMAGES per part); the type is read from the file itself, not its name. Each photo
  # is served here (signed-in users with Products access), not from a public link.
  class ProductImagesController < ApplicationController
    TYPES = %w[image/jpeg image/png image/webp image/gif].freeze
    MAX_BYTES = 5.megabytes

    before_action :load_product

    def create
      files = Array(params[:files]).select { |f| f.respond_to?(:path) }
      return render_error("Choose one or more images.", :unprocessable_content) if files.empty?
      if @product.images.count + files.size > Product::MAX_IMAGES
        return render_error("A part can have at most #{Product::MAX_IMAGES} images (it has #{@product.images.count}).", :unprocessable_content)
      end
      if (big = files.find { |f| File.size(f.path) > MAX_BYTES })
        return render_error("#{big.original_filename} is larger than #{MAX_BYTES / 1.megabyte} MB.", :unprocessable_content)
      end

      blobs = files.map do |file|
        ActiveStorage::Blob.create_and_upload!(io: File.open(file.path, "rb"), filename: ActiveStorage::Filename.new(file.original_filename.to_s).sanitized,
                                               identify: true)
      end
      if (bad = blobs.find { |b| TYPES.exclude?(b.content_type) })
        blobs.each(&:purge)
        return render_error("#{bad.filename} is not a JPG, PNG, WebP or GIF image.", :unprocessable_content)
      end

      @product.images.attach(blobs)
      audit("product.images_added", subject: @product, part_number: @product.part_number, files: blobs.map { |b| b.filename.to_s })
      render json: { data: Serializers.product_images(@product.reload) }, status: :created
    end

    def show
      image = @product.images.find(params[:id])
      expires_in 1.hour, private: true
      send_data image.download, filename: image.filename.to_s, type: image.content_type, disposition: "inline"
    end

    def destroy
      image = @product.images.find(params[:id])
      name = image.filename.to_s
      image.purge
      audit("product.image_removed", subject: @product, part_number: @product.part_number, file: name)
      head :no_content
    end

    private

    def load_product
      @product = Product.find(params[:product_id])
    end
  end
end
