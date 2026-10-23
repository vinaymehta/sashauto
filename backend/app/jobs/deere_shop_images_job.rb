# Adds the main image from John Deere's shop (DeereShopImages) to every product that has no image yet. Started with
# `bin/rails products:deere_images` (optionally LIMIT=20, or PART=JXAL117012 for one part). One run at a time; safe to
# run again: products that got an image are skipped. Progress and the result are in the Sidekiq log ([deere_shop]).
class DeereShopImagesJob < ApplicationJob
  queue_as :default
  # Not retried: the next run picks up whatever is still missing.
  sidekiq_options retry: false

  LOCK_KEY = "deere_shop_images:lock".freeze
  LOCK_TTL = 6.hours.to_i

  # `limit`: at most this many products; `part`: only this Part Number.
  def perform(limit = nil, part = nil)
    token = SecureRandom.hex(8)
    log = DeereShopImages.logger
    unless REDIS_POOL.with { |r| r.set(LOCK_KEY, token, nx: true, ex: LOCK_TTL) }
      log.warn("a run is already going; this one is skipped")
      return
    end

    begin
      products = Product.where.missing(:images_attachments).order(:part_number)
      products = products.where(part_number: OrderRows::Normalizer.part_number(part)) if part.present?
      products = products.limit(Integer(limit)) if limit.present?
      log.info("job started#{" (LIMIT=#{limit})" if limit.present?}#{" (PART=#{part})" if part.present?}: #{products.count} products without an image")
      DeereShopImages.new.call(products.to_a)
    ensure
      REDIS_POOL.with { |r| r.del(LOCK_KEY) if r.get(LOCK_KEY) == token }
    end
  end
end
