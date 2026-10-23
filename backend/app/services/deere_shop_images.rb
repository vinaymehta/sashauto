require "net/http"

# Fetches each product's main image from John Deere's shop (shop.deere.com) and adds it to the product (Products → part
# panel → Images). For each product without an image: search its part number without the leading "JX" (JXAL117012 →
# AL117012) in the shop's search box, click the result whose title starts with that number ("AL117012: Starter Motor
# Relay Module"), and download the main image of the product page. A part the shop does not list is skipped.
#
#   DeereShopImages.new.call(Product.where(...))   # { found:, not_found:, failed: }
#
# Run with `bin/rails products:deere_images` (DeereShopImagesJob). Progress goes to the Sidekiq log ([deere_shop], one
# line per product; the run ends with the parts not found and failed). A product that fails is reported to Bugsnag
# (part number, search, page); a crash of the whole run is reported by Bugsnag's Sidekiq integration.
class DeereShopImages
  HOME_URL = "https://shop.deere.com/us".freeze
  SEARCH_BOX_CSS = "input#search-box".freeze
  # The product page's main image (in the gallery's image container).
  MAIN_IMAGE_CSS = ".imageContainer img".freeze
  # Deere's image server takes the size in the address: ask for a sharper one than the page shows (560 px).
  IMAGE_SIZE = 1000
  # The shop is slow (its page and search box can take a minute to come up), so each step waits generously.
  PAGE_TIMEOUT = 90         # a page to load
  SEARCH_BOX_TIMEOUT = 60   # the search box to appear
  RESULT_TIMEOUT = 30       # the search results to appear
  NO_MATCH_SETTLE = 5       # results shown without this part for this long = not in the shop
  PRODUCT_PAGE_TIMEOUT = 60 # the product page (and its image) after clicking the result
  PAUSE = 3 # seconds after every request to the shop (page load, search, image download), to go easy on it
  MAX_BYTES = 5.megabytes
  TYPES = %w[image/jpeg image/png image/webp].freeze
  # The shop did not show what the script expects (no search box, product page not opening).
  class PageError < StandardError; end
  # After this many failures in a row the shop is blocking us or has changed: the run stops instead of going on.
  MAX_FAILURES_IN_A_ROW = 5
  # Lines in the Sidekiq log, tagged [deere_shop].
  def self.logger
    @logger ||= ActiveSupport::Logger.new($stdout).tap do |l|
      l.formatter = proc { |severity, time, _, msg| "#{time.strftime('%Y-%m-%d %H:%M:%S')} #{severity.ljust(5)} [deere_shop] #{msg}\n" }
    end
  end

  def initialize
    @log = self.class.logger
    @webdriversetup = WebdriverSetup.new
    @driver = @webdriversetup.driver
    @wait = @webdriversetup.wait
  end

  # Products without images get the shop's main image. Returns the counts; each product is logged.
  def call(products)
    counts = { found: 0, not_found: 0, failed: 0 }
    missed = { not_found: [], failed: [] }
    started = Time.current
    @log.info("run started: #{products.size} products")
    open_page(HOME_URL)
    failures_in_a_row = 0
    products.each_with_index do |product, i|
      query = search_term(product.part_number)
      @log.info("(#{i + 1}/#{products.size}) #{product.part_number}: searching #{query}")
      result = fetch(product, query)
      counts[result] += 1
      missed[result] << product.part_number if missed.key?(result)
      failures_in_a_row = 0
      sleep PAUSE
    rescue StandardError => e
      counts[:failed] += 1
      missed[:failed] << product.part_number
      log_failure(product, e)
      failures_in_a_row += 1
      if failures_in_a_row >= MAX_FAILURES_IN_A_ROW
        @log.error("stopping: #{failures_in_a_row} failures in a row (the shop is blocking us or has changed); #{products.size - i - 1} parts not tried")
        break
      end
      begin
        open_page(HOME_URL) # start the next product from a clean page
      rescue StandardError => e2
        @log.error("could not reopen #{HOME_URL} (#{e2.class}: #{e2.message.lines.first&.strip})")
      end
    end
    summary(counts, missed, started)
    counts
  rescue StandardError => e
    @log.error("run stopped: #{e.class}: #{e.message.lines.first&.strip}\n  #{Array(e.backtrace).first(5).join("\n  ")}")
    raise
  ensure
    @driver.quit
  end

  # JXAL117012 → AL117012; a part number without JX is searched as it is.
  def search_term(part_number)
    part_number.to_s.strip.sub(/\AJX/i, "")
  end

  private

  def fetch(product, query)
    unless open_product_page(query)
      @log.warn("#{product.part_number}: NOT FOUND - no shop result titled \"#{query}:\"")
      return :not_found
    end

    src = main_image_src
    if src.blank?
      @log.warn("#{product.part_number}: NOT FOUND - product page has no image (#{@driver.current_url})")
      return :not_found
    end

    blob = attach(product, sized(src))
    @log.info("#{product.part_number}: image added #{blob.filename} (#{(blob.byte_size / 1024.0).round} KB) from #{@driver.current_url}")
    :found
  end

  # Types the part number in the search box and clicks the result whose title starts with "<part number>:". False when
  # the shop shows no such result.
  def open_product_page(query)
    box = search_box
    box.click
    box.send_keys([ :control, "a" ], :backspace)
    box.send_keys(query)
    sleep PAUSE
    result = find_result(query)
    return false unless result

    @driver.execute_script("arguments[0].click();", result)
    sleep PAUSE
    Selenium::WebDriver::Wait.new(timeout: PRODUCT_PAGE_TIMEOUT).until { @driver.current_url.include?("/p/") && @driver.find_elements(css: MAIN_IMAGE_CSS).any? }
    true
  rescue Selenium::WebDriver::Error::TimeoutError
    # Only "no result for this part" is not found; a product page that does not open is a failure.
    raise PageError, "the product page did not open after clicking the result"
  end

  # The shop's search box. Its absence means the shop did not show its normal page (an "Access Denied" / bot check
  # page, a pop-up, or a changed site): a failure, with the page's title, not a part "not found".
  def search_box
    Selenium::WebDriver::Wait.new(timeout: SEARCH_BOX_TIMEOUT).until { @driver.find_elements(css: SEARCH_BOX_CSS).find(&:displayed?) }
  rescue Selenium::WebDriver::Error::TimeoutError
    raise PageError, "no search box on the page (title: #{@driver.title.inspect})"
  end

  # The search dropdown's result for exactly this part number ("AL117012: …"), or nil when the shop does not list it:
  # its results for this search ("TOP RESULTS FOR "AL117012"") have been showing for NO_MATCH_SETTLE seconds without
  # it. Results that are slow to come are waited for (RESULT_TIMEOUT); if none come at all it is a failure, not "not found".
  def find_result(query)
    xpath = "//*[@role='button'][.//h6[starts-with(normalize-space(.), '#{query.delete("'")}:')]]"
    deadline = Time.now + RESULT_TIMEOUT
    shown_at = nil
    loop do
      match = @driver.find_elements(xpath: xpath).find(&:displayed?)
      return match if match

      if results_shown?(query)
        shown_at ||= Time.now
        return nil if Time.now - shown_at >= NO_MATCH_SETTLE
      end
      raise PageError, "no search results appeared within #{RESULT_TIMEOUT}s" if Time.now > deadline

      sleep 0.5
    end
  end

  # The dropdown shows the shop's results for this search ("TOP RESULTS FOR "AL117012"", or a no-results message).
  def results_shown?(query)
    text = @driver.execute_script("return document.body ? document.body.innerText : '';").to_s.upcase
    text.include?(%(RESULTS FOR "#{query.upcase}")) || text.include?("NO RESULTS")
  end

  def main_image_src
    image = @driver.find_elements(css: MAIN_IMAGE_CSS).find(&:displayed?)
    image && @driver.execute_script("return arguments[0].currentSrc || arguments[0].src;", image)
  end

  # The image address with the larger size (w= / h= of Deere's image server); other addresses unchanged.
  def sized(src)
    uri = URI(src)
    return src unless uri.query&.match?(/(^|&)w=\d+/)

    uri.query = uri.query.gsub(/(^|&)w=\d+/, "\\1w=#{IMAGE_SIZE}").gsub(/(^|&)h=\d+/, "\\1h=#{IMAGE_SIZE}")
    uri.to_s
  end

  # Downloads the image and adds it to the product (named after the part number), checking it is a real image.
  def attach(product, url)
    response = download(URI(url))
    sleep PAUSE
    raise "image download failed (HTTP #{response.code})" unless response.is_a?(Net::HTTPSuccess)
    raise "image larger than #{MAX_BYTES / 1.megabyte} MB" if response.body.bytesize > MAX_BYTES

    extension = { "image/webp" => "webp", "image/png" => "png" }.fetch(response.content_type, "jpg")
    blob = ActiveStorage::Blob.create_and_upload!(io: StringIO.new(response.body), filename: "#{product.part_number}.#{extension}", identify: true)
    unless TYPES.include?(blob.content_type)
      blob.purge
      raise "not an image (#{blob.content_type})"
    end
    product.images.attach(blob)
    blob
  end

  # A failed product: logged, and reported to Bugsnag with the part number, the search and the page it was on.
  def log_failure(product, error)
    url = (@driver.current_url rescue "?")
    @log.error("#{product.part_number}: FAILED - #{error.class}: #{error.message.lines.first&.strip} (page: #{url})")
    Bugsnag.notify(error) do |event|
      event.severity = "warning"
      event.context = "DeereShopImages"
      event.add_metadata(:deere_shop, { part_number: product.part_number, search: search_term(product.part_number), page: url })
    end
  end

  # The run's totals and the part numbers to look at.
  def summary(counts, missed, started)
    minutes = ((Time.current - started) / 60).round(1)
    @log.info("run finished in #{minutes} min: #{counts[:found]} images added, #{counts[:not_found]} not found, #{counts[:failed]} failed")
    @log.warn("not found (#{missed[:not_found].size}): #{missed[:not_found].join(', ')}") if missed[:not_found].any?
    @log.error("failed (#{missed[:failed].size}): #{missed[:failed].join(', ')}") if missed[:failed].any?
  end

  def download(uri, redirects = 3)
    response = Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == "https", open_timeout: 15, read_timeout: 30) do |http|
      http.get(uri.request_uri, "User-Agent" => @driver.execute_script("return navigator.userAgent;"), "Accept" => "image/*")
    end
    return download(URI.join(uri, response["location"]), redirects - 1) if response.is_a?(Net::HTTPRedirection) && redirects.positive?

    response
  end

  def open_page(url)
    @driver.get(url)
    Selenium::WebDriver::Wait.new(timeout: PAGE_TIMEOUT).until { @driver.execute_script("return document.readyState") == "complete" }
    sleep PAUSE # the shop builds its page (and search box) with JavaScript after loading
  end
end
