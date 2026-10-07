module Api
  # User accounts, managed by admins: list (search, filters, sort and pagination in PostgreSQL), create,
  # edit, deactivate/reactivate and password reset. A created or reset account gets its password by email and
  # must choose its own at first sign-in. Users are never deleted (uploads, orders and the audit log refer to
  # them); deactivating blocks sign-in and ends their sessions.
  class UsersController < ApplicationController
    SORTS = {
      "name" => "users.name", "email" => "users.email", "role" => "users.role",
      "last_login_at" => "users.last_login_at", "created_at" => "users.created_at"
    }.freeze

    before_action -> { require_role(:admin) }
    rate_limit to: 60, within: 1.hour, only: %i[create reset_password], store: RATE_LIMIT_STORE,
               by: -> { current_user&.id || request.remote_ip },
               with: -> { render_error "Too many account changes in a short time. Try again later.", :too_many_requests }

    def index
      scope = User.all
      if params[:q].present?
        term = "%#{User.sanitize_sql_like(params[:q].to_s.strip.first(100))}%"
        scope = scope.where("users.name ILIKE :t OR users.email ILIKE :t", t: term)
      end
      roles = multi_param(:role, User::ROLES)
      scope = scope.where(role: roles) if roles.any?
      statuses = multi_param(:status, %w[active inactive])
      scope = scope.where(active: statuses.map { |s| s == "active" }) if statuses.any?
      scope, sort, direction = apply_sort(scope, SORTS, default: "name")
      users, meta = paginate(scope)
      render json: { data: users.map { |u| Serializers.user(u) }, meta: meta.merge(sort: sort, direction: direction) }
    end

    def create
      password = params[:password].presence || User.generate_password
      user = User.new(user_params.merge(password: password, must_change_password: true, active: true, created_by: current_user))
      if user.save
        audit("user.created", subject: user, email: user.email, role: user.role)
        render json: credentials_response(user, password, reset: false), status: :created
      else
        render_validation_errors(user)
      end
    rescue ActiveRecord::RecordNotUnique
      render_error "A user with this email already exists.", :unprocessable_content, details: { email: [ "is already used" ] }
    end

    def update
      user = User.find(params[:id])
      attrs = user_params
      attrs[:active] = ActiveModel::Type::Boolean.new.cast(params[:active]) if params.key?(:active)
      if (problem = lockout_problem(user, attrs))
        return render_error problem, :unprocessable_content
      end

      was_active = user.active
      if user.update(attrs)
        action = if was_active && !user.active then "user.deactivated"
        elsif !was_active && user.active then "user.reactivated"
        else "user.updated"
        end
        audit(action, subject: user, email: user.email, role: user.role, changes: user.previous_changes.except("updated_at").keys)
        render json: { data: Serializers.user(user) }
      else
        render_validation_errors(user)
      end
    rescue ActiveRecord::RecordNotUnique
      render_error "A user with this email already exists.", :unprocessable_content, details: { email: [ "is already used" ] }
    end

    # Sets a new password (given or generated), emails it, and signs the user out of every session; they must
    # choose their own at the next sign-in.
    def reset_password
      user = User.find(params[:id])
      password = params[:password].presence || User.generate_password
      if user.update(password: password, must_change_password: true)
        audit("user.password_reset", subject: user, email: user.email)
        render json: credentials_response(user, password, reset: true)
      else
        render_error user.errors.full_messages.to_sentence, :unprocessable_content, details: { password: user.errors[:password] }
      end
    end

    private

    def user_params
      params.permit(:name, :email, :role).to_h.symbolize_keys
    end

    # An admin cannot lock themselves out, and the last active admin cannot be removed.
    def lockout_problem(user, attrs)
      losing_admin = user.admin? && user.active && (attrs.key?(:role) && attrs[:role] != "admin" || attrs[:active] == false)
      return nil unless losing_admin
      return "You cannot deactivate your own account or remove your own Admin role." if user == current_user
      return "This is the only active Admin. Make another user an Admin first." if User.active.admins.where.not(id: user.id).none?
      nil
    end

    # Emails the sign-in details now (not queued: the password must not be stored in Redis). When the email
    # cannot be sent, the account is still saved and the password is returned once so the admin can share it.
    def credentials_response(user, password, reset:)
      AccountMailer.with(user: user, password: password, reset: reset).credentials.deliver_now
      { data: Serializers.user(user), email_sent: true }
    rescue StandardError => e
      Rails.logger.error("[users] credentials email to user #{user.id} failed: #{e.class}: #{e.message}")
      audit("user.credentials_email_failed", subject: user, error: e.class.name)
      { data: Serializers.user(user), email_sent: false, password: password,
        email_error: "The email could not be sent. Share this password with #{user.name} yourself." }
    end

    def render_validation_errors(record)
      render_error record.errors.full_messages.to_sentence, :unprocessable_content, details: record.errors.to_hash
    end
  end
end
