class ApplicationController < ActionController::API
  include ActionController::Cookies
  include ActionController::RequestForgeryProtection

  SESSION_LIFETIME = 12.hours
  PER_PAGE_OPTIONS = [ 10, 25, 50, 100 ].freeze
  DEFAULT_PER_PAGE = 10

  protect_from_forgery with: :exception
  before_action :require_login

  rescue_from ActionController::InvalidAuthenticityToken do
    render_error "Your session has expired. Reload the page and try again.", :unprocessable_content, code: "invalid_csrf_token"
  end
  rescue_from ActiveRecord::RecordNotFound do
    render_error "Not found.", :not_found
  end
  rescue_from ActionController::ParameterMissing do |e|
    render_error "Missing parameter: #{e.param}.", :bad_request
  end

  private

  def current_user
    return @current_user if defined?(@current_user)
    @current_user = session_user
  end

  def session_user
    authenticated_at = session[:authenticated_at]
    return nil if session[:user_id].nil? || authenticated_at.nil?
    return nil if Time.zone.at(authenticated_at) < SESSION_LIFETIME.ago
    User.active.find_by(id: session[:user_id])
  end

  def require_login
    render_error "Please sign in.", :unauthorized, code: "unauthenticated" unless current_user
  end

  # Both roles currently share the same permissions; this is the single place to restrict an action later.
  def require_role(*roles)
    render_error "You do not have permission to do this.", :forbidden unless roles.map(&:to_s).include?(current_user.role)
  end

  def render_error(message, status, code: nil, details: nil)
    render json: { error: { message: message, code: code, details: details }.compact }, status: status
  end

  def audit(action, subject: nil, **metadata)
    AuditLog.record(action, user: current_user, subject: subject, ip: request.remote_ip, **metadata)
  end

  # Server-side sorting from a whitelist: `sorts` maps public keys (the `sort` param) to fixed SQL
  # expressions, so user input never reaches ORDER BY. `direction` is asc/desc. Ties break on id.
  # Returns [scope, sort_key, direction].
  def apply_sort(scope, sorts, default:, default_direction: :asc)
    key = sorts.key?(params[:sort]) ? params[:sort] : default
    direction = %w[asc desc].include?(params[:direction]) ? params[:direction].to_sym : (key == default ? default_direction : :asc)
    column = sorts.fetch(key)
    column = Arel.sql(column) if column.is_a?(String)
    order = direction == :desc ? column.desc.nulls_last : column.asc.nulls_last
    [ scope.reorder(order).order(scope.arel_table[:id].public_send(direction)), key, direction ]
  end

  AGE_GROUPS = %w[green yellow red].freeze

  # Age group of an order row = days since its ship date (Ageing::Rules): green 30-59, yellow 60-89,
  # red 90+ (rows under 30 days or with a future ship date have no group). "Today" is the browser's date (param `today`,
  # within a day of the server's) so filters match the colours the user sees; otherwise the server date.
  # Several groups can be selected (age=green,red): rows in any of them.
  def filter_by_age(scope)
    groups = multi_param(:age, AGE_GROUPS)
    return scope if groups.empty?

    today = request_today
    ranges = groups.map do |group|
      Ageing::Rules.ship_date_range({ "green" => 30, "yellow" => 60, "red" => 90 }.fetch(group), today)
    end
    ranges.map { |range| scope.where(ship_date: range) }.reduce(:or)
  end

  # A filter with several selected values, sent comma-separated (type=Order,Firm). Values are trimmed and
  # de-duplicated; with `allowed`, anything else is dropped. Empty means "no filter".
  def multi_param(name, allowed = nil)
    values = params[name].to_s.split(",").map(&:strip).reject(&:empty?).uniq.first(100)
    allowed ? values & allowed : values
  end

  def request_today
    date = Date.iso8601(params[:today].to_s) if params[:today].present?
    date && (date - Date.current).abs <= 1 ? date : Date.current
  rescue Date::Error
    Date.current
  end

  # Server-side offset pagination. Returns [records, meta]; a page past the end is clamped to the last page.
  def paginate(scope)
    total = scope.count(:all) # COUNT(*) even when the scope has a custom SELECT
    page, per_page, meta = pagination_meta(total)
    [ scope.offset((page - 1) * per_page).limit(per_page), meta ]
  end

  # Same pagination contract for an in-memory array (e.g. stored validation errors).
  def paginate_array(items)
    page, per_page, meta = pagination_meta(items.size)
    [ items.slice((page - 1) * per_page, per_page) || [], meta ]
  end

  def pagination_meta(total)
    per_page = PER_PAGE_OPTIONS.include?(params[:per_page].to_i) ? params[:per_page].to_i : DEFAULT_PER_PAGE
    total_pages = [ (total.to_f / per_page).ceil, 1 ].max
    page = params[:page].to_i.clamp(1, total_pages)
    from = total.zero? ? 0 : (page - 1) * per_page + 1
    to = [ page * per_page, total ].min
    [ page, per_page, { page: page, per_page: per_page, total: total, total_pages: total_pages, from: from, to: to } ]
  end
end
