# Compatibility fix for HTTParty (used by the Resend gem) on Ruby 4 / json 3.
#
# HTTParty 0.24.x parses JSON responses with `JSON.parse(body, quirks_mode: true, allow_nan: true)`.
# `quirks_mode` has been a no-op since json 2.0 and was removed in json 3.0, where it raises
# "ArgumentError: unknown keyword: quirks_mode" — so every Resend API call failed *after* the email
# had been accepted. Parsing without the option is behaviourally identical.
#
# Remove this file once HTTParty stops passing `quirks_mode`.
require "httparty"

module HttpartyJsonCompat
  def json
    JSON.parse(body, allow_nan: true)
  end
end

HTTParty::Parser.prepend(HttpartyJsonCompat) if HTTParty::Parser.private_method_defined?(:json) ||
                                                 HTTParty::Parser.method_defined?(:json)
