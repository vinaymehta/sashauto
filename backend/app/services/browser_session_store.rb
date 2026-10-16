require 'json'
require 'fileutils'

# Persists a logged-in browser session (cookies + localStorage + sessionStorage)
# to disk so a brand-new Selenium driver can pick it up and skip the login form.
#
# Why not just reuse a Chrome --user-data-dir profile?
#   * Chrome drops session-only cookies (no Expires) on restart, and many SSO
#     providers (Okta's `sid`, etc.) issue exactly those -- so a profile alone
#     still logs you out.
#   * A profile dir can only be opened by one Chrome at a time; parallel
#     drivers for the same service would crash on the profile lock.
#
# Instead we dump every cookie for every domain via CDP (Network.getAllCookies
# includes httpOnly + session cookies, and covers the IdP domain as well as the
# app domain), plus Web Storage for the origins we visited, and replay them
# into each new driver before it navigates anywhere.
#
#   store = BrowserSessionStore.new('my_service')
#   store.restore(driver)            # before the first driver.get
#   ...login if still needed...
#   store.capture_storage(driver)    # on each origin whose storage matters
#   store.save(driver)               # persist cookies + captured storage
class BrowserSessionStore
  SESSIONS_DIR = Rails.root.join('tmp', 'browser_sessions')
  # CookieParam fields Network.setCookies accepts; everything else returned by
  # getAllCookies (size, session, partitionKey, ...) is dropped.
  COOKIE_PARAM_KEYS = %w[name value domain path secure httpOnly sameSite expires priority sourceScheme sourcePort].freeze

  def initialize(key)
    @path = SESSIONS_DIR.join("#{key}.json")
    @storage = {} # origin => { 'local' => {...}, 'session' => {...} }
  end

  def exists?
    File.exist?(@path)
  end

  # Loads the saved cookies into the browser and registers a pre-page script
  # that seeds localStorage/sessionStorage for each saved origin before the
  # site's own JS runs. Must be called before the first navigation.
  def restore(driver)
    return false unless exists?

    data = JSON.parse(File.read(@path))
    @storage = data['storage'] || {}

    cookies = (data['cookies'] || []).map do |c|
      param = c.slice(*COOKIE_PARAM_KEYS)
      param.delete('expires') if c['session'] || c['expires'].to_f <= 0
      param
    end
    driver.execute_cdp('Network.setCookies', cookies: cookies) if cookies.any?

    driver.execute_cdp('Page.addScriptToEvaluateOnNewDocument', source: storage_seed_script) if @storage.any?
    true
  rescue StandardError => e
    Rails.logger.warn "BrowserSessionStore: restore failed for #{@path}: #{e.message}"
    false
  end

  # Snapshots Web Storage for the page currently loaded in the driver.
  def capture_storage(driver)
    snapshot = driver.execute_script(<<~JS)
      const dump = (s) => { const o = {}; for (let i = 0; i < s.length; i++) { const k = s.key(i); o[k] = s.getItem(k); } return o; };
      return { origin: location.origin, local: dump(localStorage), session: dump(sessionStorage) };
    JS
    return if snapshot.nil? || snapshot['origin'].to_s.start_with?('null')

    @storage[snapshot['origin']] = { 'local' => snapshot['local'], 'session' => snapshot['session'] }
  rescue StandardError => e
    Rails.logger.warn "BrowserSessionStore: capture_storage failed: #{e.message}"
  end

  def save(driver)
    cookies = driver.execute_cdp('Network.getAllCookies')['cookies']
    FileUtils.mkdir_p(SESSIONS_DIR)
    tmp_path = "#{@path}.#{Process.pid}.tmp"
    File.write(tmp_path, JSON.pretty_generate(saved_at: Time.now.utc.iso8601, cookies: cookies, storage: @storage))
    File.chmod(0o600, tmp_path) # contains live auth tokens
    File.rename(tmp_path, @path)
  rescue StandardError => e
    Rails.logger.warn "BrowserSessionStore: save failed for #{@path}: #{e.message}"
  end

  def clear
    FileUtils.rm_f(@path)
    @storage = {}
  end

  private

  # Only fills keys that aren't already set, so storage the site writes itself
  # during this run is never clobbered on later navigations.
  def storage_seed_script
    <<~JS
      (function () {
        const saved = #{@storage.to_json};
        const entry = saved[location.origin];
        if (!entry) return;
        const seed = (store, items) => {
          try {
            Object.keys(items || {}).forEach((k) => { if (store.getItem(k) === null) store.setItem(k, items[k]); });
          } catch (e) {}
        };
        seed(window.localStorage, entry.local);
        seed(window.sessionStorage, entry.session);
      })();
    JS
  end
end
