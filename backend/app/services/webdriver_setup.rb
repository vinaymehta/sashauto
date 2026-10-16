require 'selenium-webdriver'
require 'securerandom'
require 'fileutils'

class WebdriverSetup
  # Raised when no chromedriver slot frees up within SLOT_WAIT_TIMEOUT.
  # Callers should let this bubble up like any other StandardError -- the
  # existing per-job rescue/ensure handling (SingleUrlParserWorker etc.)
  # already treats a failed scrape as "retry later".
  class CapacityError < StandardError; end

  # Keyed by Thread.object_id so each Sidekiq thread has its own isolated list.
  # Thread 1's entry is never visible to Thread 2, 3, or 4.
  DRIVER_REGISTRY = {}
  REGISTRY_MUTEX  = Mutex.new

  # Cross-process, cross-Sidekiq-instance cap on how many chromedriver
  # processes may be alive at once, enforced via Redis (shared by every
  # Sidekiq process on the box, not just threads within one process).
  # This is what actually bounds runaway spawning -- whether the cause is
  # a tight loop creating a WebdriverSetup per near-instant batch, or extra
  # Sidekiq processes left over from a bad deploy pushing real concurrency
  # above what the queue configs say.
  ACTIVE_DRIVERS_KEY  = 'webdriver_setup:active_drivers'
  MAX_CONCURRENT_DRIVERS = (ENV['MAX_CHROMEDRIVERS'] || 20).to_i
  # A slot that's still "active" after this long is assumed to belong to a
  # driver that died without releasing it (hard-killed process, etc.) --
  # it's pruned automatically so a genuine leak can never permanently eat
  # into capacity. Set comfortably above the 600s sidekiq job timeout.
  SLOT_STALE_SECONDS  = 900
  SLOT_WAIT_TIMEOUT   = 120
  SLOT_POLL_INTERVAL  = 2

  def initialize(download_folder = nil)
    root_path = Dir.pwd
    file_path = download_folder ? "#{root_path}/public/#{download_folder}/" : "#{root_path}/public/"
    FileUtils.mkdir_p(file_path) if download_folder
    download_prefs = {
      prompt_for_download: false,
      default_directory: file_path
    }
    plugin_prefs = {
      always_open_pdf_externally: true
    }
    # port = 9514 + rand(1000)
    @client = Selenium::WebDriver::Remote::Http::Default.new
    @client.read_timeout = 600
    @client.open_timeout = 600
    @options = Selenium::WebDriver::Chrome::Options.new
    # No user-agent override: the `--user-agent` flag only rewrites
    # navigator.userAgent/the UA header, but Sec-Ch-Ua/Sec-Ch-Ua-Platform
    # (client hints) are generated straight from the real installed Chrome
    # binary and can't be changed by that flag. A stale spoofed UA (an old
    # Windows Chrome build) next to client hints reporting the real, current
    # macOS/Chromium version is exactly the kind of cross-signal mismatch
    # bot-detection vendors flag. Leaving the UA alone keeps every navigator/
    # header/client-hint value internally consistent.
    @options.add_argument('window-size=1920,1080')
    # The new headless mode renders through the same code path as headful
    # Chrome (unlike legacy --headless), so window.outerWidth/outerHeight,
    # plugin/media-codec support, and other headless-only tells no longer
    # differ from a real browser window.
    @options.add_argument('--headless=new')
    # Reduce per-instance memory footprint
    @options.add_argument('--disable-dev-shm-usage')
    @options.add_argument('--no-sandbox')
    @options.add_argument('--disable-gpu')
    @options.add_argument('--disable-extensions')
    @options.add_argument('--disable-background-networking')
    @options.add_argument('--disable-background-timer-throttling')
    @options.add_argument('--disable-renderer-backgrounding')
    @options.add_argument('--disable-backgrounding-occluded-windows')
    @options.add_argument('--blink-settings=imagesEnabled=false')
    # Suppresses the "Chrome is being controlled by automated test software"
    # infobar/extension and the associated automation-only code paths --
    # without this, navigator.webdriver is forced true regardless of the
    # stealth script below.
    @options.add_argument('--disable-blink-features=AutomationControlled')
    @options.add_option(:exclude_switches, ['enable-automation'])
    @options.add_preference(:download, download_prefs)
    @options.add_preference(:plugins, plugin_prefs)
  end

  # Injected into every page (via CDP, before any site JS runs) to remove the
  # soft automation tells that survive the Chrome-flag hardening above:
  # navigator.webdriver, an empty navigator.plugins/mimeTypes list (headless
  # Chrome ships no PDF/plugin objects by default), and window.outerWidth/
  # outerHeight reporting 0 (headless has no real window chrome to size).
  STEALTH_SCRIPT = <<~JS
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

    const fakePlugin = (name, filename, description) => ({
      name, filename, description, length: 1,
      item: () => null, namedItem: () => null
    });
    const pluginsData = [
      fakePlugin('PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
      fakePlugin('Chrome PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
      fakePlugin('Chromium PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
      fakePlugin('Microsoft Edge PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
      fakePlugin('WebKit built-in PDF', 'internal-pdf-viewer', 'Portable Document Format')
    ];
    Object.defineProperty(navigator, 'plugins', { get: () => pluginsData });
    const mimeTypesData = [
      { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format', enabledPlugin: pluginsData[0] },
      { type: 'text/pdf', suffixes: 'pdf', description: 'Portable Document Format', enabledPlugin: pluginsData[0] }
    ];
    Object.defineProperty(navigator, 'mimeTypes', { get: () => mimeTypesData });

    if (window.outerWidth === 0 && window.outerHeight === 0) {
      Object.defineProperty(window, 'outerWidth', { get: () => window.innerWidth });
      Object.defineProperty(window, 'outerHeight', { get: () => window.innerHeight + 85 });
    }

    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    window.chrome = window.chrome || { runtime: {} };
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) => (
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : originalQuery(parameters)
    );
  JS

  def wait
    Selenium::WebDriver::Wait.new(timeout: 10)
  end

  # Every driver created anywhere (initialize, scrap_news, scrap_articles, etc.)
  # is registered under this thread's ID so quit_job_drivers can clean them all up.
  #
  # Blocks (briefly) if the system-wide chromedriver cap is already full, and
  # raises CapacityError if a slot never frees up -- this is what stands
  # between a runaway loop / duplicate Sidekiq processes and an unbounded
  # pile of chromedriver processes.
  #
  # Two independent leak sources are handled here, neither of which a normal
  # `driver.quit` wrapper can fix:
  #
  # 1. Selenium::WebDriver.for spawns the real chromedriver process FIRST,
  #    then waits up to ~20s for it to become reachable -- if that stabilize
  #    step fails/times out, `.for` raises and NO Driver object is ever
  #    returned. There is then nothing in Ruby to ever call #quit on, and
  #    the already-spawned OS process is orphaned permanently. We take a
  #    before/after snapshot of chromedriver PIDs around the call so a
  #    failure like this can still be cleaned up.
  # 2. Even when a Driver IS returned, its #quit calling the gem's own
  #    ServiceManager#stop is not something we can fully trust to have
  #    actually killed the OS process on this box (something -- possibly
  #    interaction with another gem's SIGCHLD/process handling -- appears to
  #    leave chromedriver alive after a clean #quit). So #quit is wrapped to
  #    independently verify, by PID, that the process is actually gone
  #    afterward, and force-kills it directly if not.
  #
  # Every existing call site (`driver.quit`, `@driver.quit`, quit_job_drivers)
  # gets both of these for free -- no other file needs to change.
  def driver
    slot_id = acquire_slot!
    before_pids = chromedriver_pids

    begin
      d = Selenium::WebDriver.for :chrome, options: @options, http_client: @client
    rescue StandardError
      release_slot(slot_id)
      kill_new_orphans(before_pids)
      raise
    end

    inject_stealth_script(d)
    normalize_headless_user_agent(d)
    port = driver_port(d)
    wrap_quit(d, slot_id, port)

    REGISTRY_MUTEX.synchronize do
      (DRIVER_REGISTRY[Thread.current.object_id] ||= []) << d
    end
    d
  end

  # Called from SingleUrlParserWorker's ensure block.
  # Removes and quits only the drivers created during the current thread's job.
  # Other threads' entries are untouched.
  def self.quit_job_drivers
    drivers = REGISTRY_MUTEX.synchronize do
      DRIVER_REGISTRY.delete(Thread.current.object_id) || []
    end
    drivers.each { |d| d.quit rescue nil }
  end

  private

  # Runs before any page script on every navigation (including client-side
  # redirects), unlike execute_script which would only apply to the current
  # page and re-expose the raw flags on the very next navigation.
  def inject_stealth_script(driver_instance)
    driver_instance.execute_cdp('Page.addScriptToEvaluateOnNewDocument', source: STEALTH_SCRIPT)
  rescue StandardError => e
    Rails.logger.warn "WebdriverSetup: failed to inject stealth script: #{e.message}"
  end

  # `--headless=new` otherwise leaves the literal substring "HeadlessChrome/"
  # in both navigator.userAgent and the actual User-Agent header sent on the
  # wire (confirmed against real request headers) -- the single most
  # obvious bot tell there is. This strips it via CDP so the fix always
  # tracks whatever Chrome version is actually installed, rather than
  # hardcoding a version/UA string that goes stale the next Chrome upgrade.
  #
  # Sec-Ch-Ua/-Platform/-Mobile (client hints) already report the real,
  # non-headless browser correctly and are left untouched -- except that
  # overriding the User-Agent via CDP without also passing userAgentMetadata
  # blanks those headers out entirely (verified against real request
  # headers), which is its own mismatch (a "Chrome/152" UA with zero client
  # hints). So userAgentMetadata is rebuilt from the same real UA string to
  # keep every value consistent with each other.
  def normalize_headless_user_agent(driver_instance)
    real_ua = driver_instance.execute_script('return navigator.userAgent')
    return unless real_ua&.include?('HeadlessChrome/')

    fixed_ua = real_ua.sub('HeadlessChrome/', 'Chrome/')
    params = { userAgent: fixed_ua }
    metadata = user_agent_metadata_for(real_ua)
    params[:userAgentMetadata] = metadata if metadata

    driver_instance.execute_cdp('Network.setUserAgentOverride', **params)
  rescue StandardError => e
    Rails.logger.warn "WebdriverSetup: failed to normalize headless user-agent: #{e.message}"
  end

  def user_agent_metadata_for(real_ua)
    full_version = real_ua[/Chrome\/([\d.]+)/, 1]
    return nil unless full_version

    major = full_version.split('.').first
    platform =
      if real_ua.include?('Macintosh')
        'macOS'
      elsif real_ua.include?('Windows')
        'Windows'
      elsif real_ua.include?('Linux')
        'Linux'
      end

    {
      platform: platform,
      platformVersion: '',
      architecture: '',
      model: '',
      mobile: false,
      brands: [
        { brand: 'Chromium', version: major },
        { brand: 'Not?A_Brand', version: '24' },
        { brand: 'Google Chrome', version: major }
      ],
      fullVersionList: [
        { brand: 'Chromium', version: full_version },
        { brand: 'Not?A_Brand', version: '24.0.0.0' },
        { brand: 'Google Chrome', version: full_version }
      ]
    }
  end

  def acquire_slot!
    slot_id = "#{Process.pid}-#{Thread.current.object_id}-#{SecureRandom.hex(4)}"
    deadline = Time.now + SLOT_WAIT_TIMEOUT

    loop do
      count = REDIS_POOL.with do |r|
        r.zremrangebyscore(ACTIVE_DRIVERS_KEY, '-inf', (Time.now - SLOT_STALE_SECONDS).to_i)
        r.zcard(ACTIVE_DRIVERS_KEY)
      end

      if count < MAX_CONCURRENT_DRIVERS
        REDIS_POOL.with { |r| r.zadd(ACTIVE_DRIVERS_KEY, Time.now.to_i, slot_id) }
        return slot_id
      end

      if Time.now > deadline
        raise CapacityError, "No chromedriver slot freed up within #{SLOT_WAIT_TIMEOUT}s " \
                              "(#{count}/#{MAX_CONCURRENT_DRIVERS} slots in use)"
      end

      sleep SLOT_POLL_INTERVAL
    end
  end

  def release_slot(slot_id)
    return unless slot_id

    REDIS_POOL.with { |r| r.zrem(ACTIVE_DRIVERS_KEY, slot_id) }
  rescue StandardError
    nil
  end

  def wrap_quit(driver_instance, slot_id, port)
    webdriver_setup = self
    driver_instance.define_singleton_method(:quit) do
      super()
    rescue StandardError
      nil
    ensure
      webdriver_setup.send(:release_slot, slot_id)
      webdriver_setup.send(:hard_kill_if_still_alive, port) if port
    end
  end

  # The exact port this driver's http client ended up bound to.
  # Bridge#initialize sets this on the SAME http_client object we passed in
  # and hold as @client, so this is our own object's state -- not a private
  # gem internal -- except the reader on it happens to be private, hence send.
  def driver_port(_driver_instance)
    @client.send(:server_url)&.port
  rescue StandardError
    nil
  end

  def chromedriver_pids
    `pgrep -x chromedriver`.split("\n").map(&:to_i)
  rescue StandardError
    []
  end

  # Best-effort cleanup for the "Selenium::WebDriver.for raised, no Driver
  # object exists" case. Imprecise under heavy concurrent driver creation
  # (a different thread's brand new process could show up in the diff too),
  # but the alternative is a guaranteed, permanent, unattributable leak, so
  # an occasional extra retry on another job is the acceptable tradeoff here.
  def kill_new_orphans(before_pids)
    (chromedriver_pids - before_pids).each do |pid|
      Process.kill('KILL', pid)
    rescue StandardError
      nil
    end
  end

  # Independently verifies (by PID, not by trusting the gem's own bookkeeping)
  # that the process behind this specific driver actually died, and force
  # kills it if not. This is intentionally not just "call driver.quit again" --
  # it goes straight to the OS level so it doesn't matter *why* the gem's own
  # ServiceManager#stop didn't finish the job.
  def hard_kill_if_still_alive(port)
    pid = nil
    4.times do
      pid = chromedriver_pid_for_port(port)
      break unless pid

      sleep 0.5
    end
    return unless pid

    Process.kill('KILL', pid)
    Rails.logger.warn "WebdriverSetup: hard-killed chromedriver on port #{port} (pid #{pid}) -- still alive after driver.quit"
  rescue Errno::ESRCH
    nil
  rescue StandardError => e
    Rails.logger.error "WebdriverSetup: hard-kill backstop failed for port #{port}: #{e.message}"
  end

  def chromedriver_pid_for_port(port)
    out = `pgrep -f "chromedriver --port=#{port}$"`.strip
    return nil if out.empty?

    out.split("\n").first.to_i
  rescue StandardError
    nil
  end

end
