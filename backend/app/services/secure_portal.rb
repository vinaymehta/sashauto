class SecurePortal
  LOGIN_URL  = "https://sso.johndeere.com/".freeze          # TODO: login page URL
  TARGET_URL = "https://jdsnofi.deere.com/jdsnofi/servlet/com.deere.jdsnofi.view.servlet.WebServiceServlet".freeze  # TODO: page that requires being logged in
  # Username field, or a password field (Okta uses name="credentials.passcode"
  # for both the password and the OTP, so type=password is what tells them apart).
  LOGIN_FORM_CSS = 'input#input28, input[name="identifier"], input#input63, input[type="password"]'.freeze

  # TODO: confirm these against the real OTP page (paste @driver.page_source
  # when it shows) -- they're generic guesses covering Okta and most SMS forms.
  OTP_SEND_CODE_CSS = 'input.button.button-primary'.freeze
  OTP_INPUT_CSS = 'input[name="credentials.passcode"]'.freeze
  OTP_SUBMIT_CSS = 'input.button.button-primary'.freeze
  OTP_MAX_ATTEMPTS = 3

  DOWNLOAD_DIR = Rails.root.join('public', 'secure_portal').to_s
  DOWNLOAD_TIMEOUT = 180
  EXCEL_BUTTON_CSS = 'a.aButton[onclick*="excelReport"]'.freeze

  def initialize
    @webdriversetup = WebdriverSetup.new('secure_portal')
    @driver = @webdriversetup.driver
    @wait = @webdriversetup.wait
    @session_store = BrowserSessionStore.new('secure_portal')
  end

  # Returns the path of the downloaded Excel report. Every download is kept in
  # DOWNLOAD_DIR, named with the date and time it was downloaded (IST), e.g.
  # SupplierRequirements_16-10-26_13-05.xlsx.
  def call
    ensure_logged_in
    download_requirement_report
  ensure
    @driver.quit
  end

  # Requirement screen: Supplier = 2nd option, Type = "All", then
  # "Download to Excel". Blocks until the file has fully landed on disk.
  def download_requirement_report
    supplier_el = @driver.find_element(id: 'supplierNum')
    supplier = Selenium::WebDriver::Support::Select.new(supplier_el)
    second_value = supplier.options[1].attribute('value')
    unless supplier.first_selected_option.attribute('value') == second_value
      choose_option(supplier_el, second_value) # onchange -> selectSupplier(..., 'refresh') reloads the form
      wait_for_form_refresh(supplier_el)
    end
    puts "Supplier: -> #{selected_text('supplierNum')}"

    choose_option(@driver.find_element(id: 'type'), 'All')
    puts "Type: -> #{selected_text('type')}"

    FileUtils.mkdir_p(DOWNLOAD_DIR)
    clicked_at = Time.now - 1
    # Headless Chrome doesn't always honour the download prefs from WebdriverSetup.
    @driver.execute_cdp('Browser.setDownloadBehavior', behavior: 'allow', downloadPath: DOWNLOAD_DIR)

    excel_button = @driver.find_element(css: EXCEL_BUTTON_CSS)
    @driver.execute_script("arguments[0].click();", excel_button)
    file_path = timestamped(wait_for_download(clicked_at))
    puts "Downloaded: -> #{file_path} (#{File.size(file_path)} bytes)"
    file_path
  end

  # Replays the saved cookies/storage (SSO session + the 30-day "device
  # verified" OTP cookie) into this fresh driver, then only does whichever
  # step the site still asks for: password login, SMS OTP, or neither.
  def ensure_logged_in
    restored = @session_store.restore(@driver)
    open_page(TARGET_URL)
    puts restored ? "Restored saved session" : "No saved session, logging in from scratch"

    # Not clearing the saved session here on purpose: the SSO session may have
    # expired while the OTP device-trust cookie is still valid, and wiping it
    # would force an OTP that isn't actually needed.
    sleep 10
    login if login_form?
    sleep 5
    verify_otp if otp_form?
    # raise "SecurePortal: not logged in, still on #{@driver.current_url}" if login_form? || otp_form?
    @session_store.capture_storage(@driver)
    @session_store.save(@driver) # refresh rotated cookies/tokens so the session keeps sliding forward
  end

  def login
    open_page(LOGIN_URL)
    sleep 3
    input_email = @driver.find_element(css: 'input[name="identifier"]')
    input_email.send_keys(ENV['SECURE_PORTAL_USERNAME'])
    sleep 3
    remember_me = @driver.find_element(css: 'input[name="rememberMe"]')
    @driver.execute_script("arguments[0].click();", remember_me)
    sleep 3
    submit_button = @driver.find_element(css: 'input.button.button-primary')
    submit_button.click
    sleep 3
    input_password = @driver.find_element(css: 'input[type="password"]')
    input_password.send_keys(ENV['SECURE_PORTAL_PASSWORD'])
    sleep 3
    submit_button = @driver.find_element(css: 'input.button.button-primary')
    submit_button.click
    sleep 5
    puts "First title: -> #{@driver.title}"
    @session_store.capture_storage(@driver)
    @session_store.save(@driver) # keep the SSO session even if the OTP step below times out
    open_page(TARGET_URL)
    sleep 3
    puts "Second title: -> #{@driver.title}"
    @session_store.capture_storage(@driver)
  end

  # Asks a human for the SMS code via /otp_requests (bell + Slack alert) and
  # types it in. Retries with a fresh request if the site rejects the code.
  def verify_otp
    handoff = OtpHandoff.new('secure_portal', label: 'John Deere (jdsnofi)')
    deadline = Time.now + OtpHandoff::WAIT_TIMEOUT
    send_code = @driver.find_elements(css: OTP_SEND_CODE_CSS).find(&:displayed?)
    if send_code
      send_code.click
      sleep 3
    end

    message = nil
    OTP_MAX_ATTEMPTS.times do
      code = handoff.wait_for_code(message: message, deadline: deadline)
      raise "SecurePortal: no OTP entered within #{OtpHandoff::WAIT_TIMEOUT}s" unless code

      puts "OTP received, submitting"
      enter_otp(code)
      unless otp_form?
        handoff.finish
        @session_store.capture_storage(@driver)
        @session_store.save(@driver) # this is what persists the 30-day device-trust cookie
        open_page(TARGET_URL) unless @driver.current_url.start_with?(TARGET_URL)
        return
      end

      message = "The last code was rejected -- check the SMS and enter the latest code."
    end
    handoff.finish
    raise "SecurePortal: OTP rejected #{OTP_MAX_ATTEMPTS} times"
  end

  def logged_in?
    !login_form? && !otp_form?
  end

  private

  def enter_otp(code)
    input = @driver.find_elements(css: OTP_INPUT_CSS).find(&:displayed?)
    raise "SecurePortal: OTP input not found on #{@driver.current_url} -- update OTP_INPUT_CSS" unless input

    input.clear
    input.send_keys(code)
    @driver.find_elements(css: OTP_SUBMIT_CSS).find(&:displayed?)&.click
    sleep 8
    @wait.until { @driver.execute_script('return document.readyState') == 'complete' }
  end

  # The supplier "refresh" either reloads the page (old element goes stale) or
  # rebuilds the form via AJAX; wait for whichever happens, then for it to settle.
  def wait_for_form_refresh(old_element)
    begin
      Selenium::WebDriver::Wait.new(timeout: 15, ignore: []).until { stale?(old_element) }
    rescue Selenium::WebDriver::Error::TimeoutError
      nil # no full reload happened -- the settle wait below covers an AJAX refresh
    end
    @wait.until { @driver.execute_script('return document.readyState') == 'complete' }
    @wait.until { @driver.find_elements(id: 'type').any? }
    sleep 3
  end

  # Picks an option of a <select>. Waits up to 15s for it to be visible and picks it like a user; when Chrome still
  # refuses (ElementNotInteractableError: the portal hides the real <select> behind its own dropdown, which broke most
  # scheduled runs), logs the <select>'s state and sets the value with JavaScript, firing the change event the page
  # listens to (its onchange).
  def choose_option(select_el, value)
    begin
      Selenium::WebDriver::Wait.new(timeout: 15).until { select_el.displayed? }
    rescue Selenium::WebDriver::Error::TimeoutError
      nil # still hidden: the fallback below handles it
    end
    Selenium::WebDriver::Support::Select.new(select_el).select_by(:value, value)
  rescue Selenium::WebDriver::Error::ElementNotInteractableError
    state = @driver.execute_script(<<~JS, select_el)
      const s = arguments[0], st = getComputedStyle(s), r = s.getBoundingClientRect(), n = s.nextElementSibling;
      return `display=${st.display} visibility=${st.visibility} size=${Math.round(r.width)}x${Math.round(r.height)} ` +
             `next=${n ? n.tagName + '.' + n.className : 'none'} ready=${document.readyState}`;
    JS
    puts "#{select_el.attribute('id')}: not clickable (#{state}); setting it with JavaScript"
    @driver.execute_script(<<~JS, select_el, value)
      arguments[0].value = arguments[1];
      arguments[0].dispatchEvent(new Event('change', { bubbles: true }));
    JS
  end

  def stale?(element)
    element.enabled?
    false
  rescue Selenium::WebDriver::Error::StaleElementReferenceError
    true
  end

  def selected_text(select_id)
    Selenium::WebDriver::Support::Select.new(@driver.find_element(id: select_id)).first_selected_option.text.strip
  end

  # Renames the download to "<name>_<dd-mm-yy>_<HH-MM>.<ext>" (IST), so each download is kept, e.g.
  # SupplierRequirements.xlsx -> SupplierRequirements_16-10-26_13-05.xlsx. Returns the new path.
  def timestamped(path)
    stamp = Time.find_zone!(AppConfig.ageing_time_zone).now.strftime('%d-%m-%y_%H-%M')
    ext = File.extname(path)
    name = File.basename(path, ext).sub(/ \(\d+\)\z/, '') # Chrome's "(1)" when the name was taken
    target = File.join(File.dirname(path), "#{name}_#{stamp}#{ext}")
    target = File.join(File.dirname(path), "#{name}_#{stamp}-#{SecureRandom.hex(2)}#{ext}") if File.exist?(target)
    File.rename(path, target)
    target
  end

  # Chrome writes "<name>.crdownload" while downloading and renames it when done.
  # Only files written after the click (`since`) count: earlier downloads are kept, and Chrome may overwrite a file
  # of the same name.
  def wait_for_download(since)
    deadline = Time.now + DOWNLOAD_TIMEOUT
    loop do
      files = Dir.glob(File.join(DOWNLOAD_DIR, '*')).select { |f| File.mtime(f) >= since }
      done = files.reject { |f| f.end_with?('.crdownload', '.tmp') || File.basename(f).start_with?('.') }
      return done.max_by { |f| File.mtime(f) } if done.any? && files.none? { |f| f.end_with?('.crdownload') }
      raise "SecurePortal: Excel download didn't finish within #{DOWNLOAD_TIMEOUT}s" if Time.now > deadline

      sleep 2
    end
  end

  def login_form?
    @driver.find_elements(css: LOGIN_FORM_CSS).any?(&:displayed?)
  end

  def otp_form?
    @driver.find_elements(css: OTP_INPUT_CSS).any?(&:displayed?) ||
      @driver.find_elements(css: OTP_SEND_CODE_CSS).any?(&:displayed?)
  end

  def open_page(url)
    @driver.get(url)
    @wait.until { @driver.execute_script('return document.readyState') == 'complete' }
    sleep 3 # SSO redirects (app -> IdP -> app) can still be in flight after readyState
  end
end