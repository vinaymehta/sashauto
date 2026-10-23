require "net/http"

# Fetches each product's main image from John Deere's shop (shop.deere.com) and adds it to the product (Products → part
# panel → Images). For each product without an image: look up its part number without the leading "JX" (JXAL117012 →
# AL117012) in the shop's search, take the result that is exactly that part, and download its main image. A part the
# shop does not list (or lists without a picture) is skipped.
#
# The shop's own pages refuse the server (CloudFront 403), so this does not open them: it asks the search service
# behind the shop's search box (Constructor.io, the same request the box makes while typing), which answers with the
# image address on Deere's image server (johndeere.widen.net). Plain web requests, no browser.
#
#   DeereShopImages.new.call(Product.where(...))   # { found:, not_found:, failed: }
#
# Run with `bin/rails products:deere_images` (DeereShopImagesJob). Progress goes to
# the Sidekiq log ([deere_shop], one line per product; the run ends with the parts not found and failed). A product that
# fails is reported to Bugsnag (part number, search); a crash of the whole run by Bugsnag's Sidekiq integration.
class DeereShopImages
  # The shop's search service and its public key (both in the shop's page; change here if the shop changes them).
  SEARCH_URL = "https://pwcdauseo-zone.cnstrc.com/autocomplete/".freeze
  SEARCH_KEY = "key_ZgAc17ef3AA19bGI".freeze
  # Deere's image server takes the size in the address: ask for a sharp one (the shop's page shows 560 px).
  IMAGE_SIZE = 1000
  PAUSE = 3 # seconds after every request (search, image download), to go easy on them
  MAX_BYTES = 5.megabytes
  TYPES = %w[image/jpeg image/png image/webp].freeze
  # After this many failures in a row the search is refusing us or has changed: the run stops instead of going on.
  MAX_FAILURES_IN_A_ROW = 5
  # Lines in the Sidekiq log, tagged [deere_shop].
  def self.logger
    @logger ||= ActiveSupport::Logger.new($stdout).tap do |l|
      l.formatter = proc { |severity, time, _, msg| "#{time.strftime('%Y-%m-%d %H:%M:%S')} #{severity.ljust(5)} [deere_shop] #{msg}\n" }
    end
  end

  def initialize
    @log = self.class.logger
  end

  # Products without images get the shop's main image. Returns the counts; each product is logged.
  def call(products)
    counts = { found: 0, not_found: 0, failed: 0 }
    missed = { not_found: [], failed: [] }
    started = Time.current
    @log.info("run started: #{products.size} products")
    failures_in_a_row = 0
    products.each_with_index do |product, i|
      query = search_term(product.part_number)
      @log.info("(#{i + 1}/#{products.size}) #{product.part_number}: searching #{query}")
      result = fetch(product, query)
      counts[result] += 1
      missed[result] << product.part_number if missed.key?(result)
      failures_in_a_row = 0
    rescue StandardError => e
      counts[:failed] += 1
      missed[:failed] << product.part_number
      log_failure(product, e)
      failures_in_a_row += 1
      if failures_in_a_row >= MAX_FAILURES_IN_A_ROW
        @log.error("stopping: #{failures_in_a_row} failures in a row (the shop's search is refusing us or has changed); #{products.size - i - 1} parts not tried")
        break
      end
    end
    summary(counts, missed, started)
    counts
  rescue StandardError => e
    @log.error("run stopped: #{e.class}: #{e.message.lines.first&.strip}\n  #{Array(e.backtrace).first(5).join("\n  ")}")
    raise
  end

  # JXAL117012 → AL117012; a part number without JX is searched as it is.
  def search_term(part_number)
    part_number.to_s.strip.sub(/\AJX/i, "")
  end

  private

  def fetch(product, query)
    item = find_part(query)
    unless item
      @log.warn("#{product.part_number}: NOT FOUND - the shop does not list #{query}")
      return :not_found
    end

    src = item["image_url"].presence
    unless src
      @log.warn("#{product.part_number}: NOT FOUND - the shop lists #{query} without a picture")
      return :not_found
    end

    blob = attach(product, sized(src))
    @log.info("#{product.part_number}: image added #{blob.filename} (#{(blob.byte_size / 1024.0).round} KB) from #{item['url']}")
    :found
  end

  # The shop's search result that is exactly this part number (its search also returns look-alikes, e.g. AM117590 for
  # MCXFA2090), or nil when the shop does not list it.
  def find_part(query)
    uri = URI("#{SEARCH_URL}#{ERB::Util.url_encode(query)}")
    uri.query = URI.encode_www_form("key" => SEARCH_KEY, "num_results_Products" => 20, "num_results_Search Suggestions" => 0)
    response = get(uri, "Accept" => "application/json")
    sleep PAUSE
    raise "shop search failed (HTTP #{response.code})" unless response.is_a?(Net::HTTPSuccess)

    products = JSON.parse(response.body).dig("sections", "Products")
    raise "shop search answered without products (has the shop changed?)" unless products.is_a?(Array)

    products.map { |p| p["data"] || {} }.find { |data| data["id"].to_s.casecmp?(query) }
  end

  # The image address with the larger size (w= / h= / position of Deere's image server); other servers unchanged.
  def sized(src)
    uri = URI(src)
    return src unless uri.host.to_s.end_with?("widen.net")

    uri.query = URI.encode_www_form(w: IMAGE_SIZE, h: IMAGE_SIZE, position: "c", color: "ffffffff", quality: 100)
    uri.to_s
  end

  # Downloads the image and attaches it to the product (named after the part number). Returns the attached blob.
  def attach(product, url)
    response = get(URI(url), "Accept" => "image/*")
    sleep PAUSE
    raise "image download failed (HTTP #{response.code})" unless response.is_a?(Net::HTTPSuccess)
    raise "image larger than #{MAX_BYTES / 1.megabyte} MB" if response.body.bytesize > MAX_BYTES
    raise "not an image (#{response.content_type})" unless TYPES.include?(response.content_type)

    extension = { "image/webp" => "webp", "image/png" => "png" }.fetch(response.content_type, "jpg")
    blob = ActiveStorage::Blob.create_and_upload!(io: StringIO.new(response.body), filename: "#{product.part_number}.#{extension}", identify: true)
    unless TYPES.include?(blob.content_type)
      blob.purge
      raise "not an image (#{blob.content_type})"
    end
    product.images.attach(blob)
    blob
  end

  # A failed product: logged, and reported to Bugsnag with the part number and the search.
  def log_failure(product, error)
    @log.error("#{product.part_number}: FAILED - #{error.class}: #{error.message.lines.first&.strip}")
    Bugsnag.notify(error) do |event|
      event.severity = "warning"
      event.context = "DeereShopImages"
      event.add_metadata(:deere_shop, { part_number: product.part_number, search: search_term(product.part_number) })
    end
  end

  # The run's totals and the part numbers to look at.
  def summary(counts, missed, started)
    minutes = ((Time.current - started) / 60).round(1)
    @log.info("run finished in #{minutes} min: #{counts[:found]} images added, #{counts[:not_found]} not found, #{counts[:failed]} failed")
    @log.warn("not found (#{missed[:not_found].size}): #{missed[:not_found].join(', ')}") if missed[:not_found].any?
    @log.error("failed (#{missed[:failed].size}): #{missed[:failed].join(', ')}") if missed[:failed].any?
  end

  BROWSER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36".freeze

  def get(uri, headers, redirects = 3)
    response = Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == "https", open_timeout: 15, read_timeout: 30) do |http|
      http.get(uri.request_uri, { "User-Agent" => BROWSER_AGENT, "Origin" => "https://shop.deere.com", "Referer" => "https://shop.deere.com/" }.merge(headers))
    end
    return get(URI.join(uri, response["location"]), headers, redirects - 1) if response.is_a?(Net::HTTPRedirection) && redirects.positive?

    response
  end
end
