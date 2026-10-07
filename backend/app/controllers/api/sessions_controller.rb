module Api
  class SessionsController < ApplicationController
    skip_before_action :require_login, only: %i[show create]
    skip_before_action :require_password_change_done
    TOO_MANY_ATTEMPTS = -> { render_error "Too many sign-in attempts. Wait a few minutes and try again.", :too_many_requests }
    rate_limit to: 10, within: 5.minutes, only: :create, store: RATE_LIMIT_STORE, name: "login-ip", with: TOO_MANY_ATTEMPTS
    # Per-account limit does not depend on client IPs, which a misconfigured proxy chain could let clients spoof.
    rate_limit to: 20, within: 15.minutes, only: :create, store: RATE_LIMIT_STORE, name: "login-email",
               by: -> { params[:email].to_s.strip.downcase.first(255) }, with: TOO_MANY_ATTEMPTS
    rate_limit to: 10, within: 15.minutes, only: :password, store: RATE_LIMIT_STORE, name: "password-change",
               by: -> { current_user&.id || request.remote_ip }, with: TOO_MANY_ATTEMPTS

    # Returns the signed-in user (or null) and a CSRF token for subsequent mutating requests.
    def show
      render json: { user: current_user && Serializers.user(current_user), csrf_token: form_authenticity_token }
    end

    def create
      user = User.authenticate_by(email: params.require(:email).to_s, password: params.require(:password).to_s)

      if user.nil? || !user.active?
        AuditLog.record("session.login_failed", ip: request.remote_ip, email: params[:email].to_s.strip.downcase.first(255))
        return render_error("Invalid email or password.", :unauthorized, code: "invalid_credentials")
      end

      reset_session # prevents session fixation
      session[:user_id] = user.id
      session[:authenticated_at] = Time.current.to_i
      user.update_column(:last_login_at, Time.current)
      @current_user = user
      audit("session.login")
      render json: { user: Serializers.user(user), csrf_token: form_authenticity_token }
    end

    # The signed-in user changes their own password (required after an admin created or reset the account).
    # The session stays signed in; every other session of the account is signed out.
    def password
      current = params.require(:current_password).to_s
      new_password = params.require(:new_password).to_s
      unless current_user.authenticate(current)
        audit("user.password_change_failed", subject: current_user)
        return render_error("Your current password is incorrect.", :unprocessable_content,
                            code: "invalid_current_password", details: { current_password: [ "is incorrect" ] })
      end
      if new_password == current
        return render_error("Choose a password different from the current one.", :unprocessable_content,
                            details: { new_password: [ "must be different from the current password" ] })
      end

      if current_user.update(password: new_password, must_change_password: false)
        session[:authenticated_at] = current_user.password_changed_at.to_i
        audit("user.password_changed", subject: current_user)
        render json: { user: Serializers.user(current_user), csrf_token: form_authenticity_token }
      else
        render_error current_user.errors.full_messages.to_sentence, :unprocessable_content,
                     details: { new_password: current_user.errors[:password] }
      end
    end

    def destroy
      audit("session.logout")
      reset_session
      head :no_content
    end
  end
end
