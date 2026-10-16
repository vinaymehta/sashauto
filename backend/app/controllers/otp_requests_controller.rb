class OtpRequestsController < ApplicationController
  skip_before_action :require_login, :require_password_change_done, :limit_warehouse_manager

  def index
    @requests = OtpHandoff.pending
  end

  def submit
    if OtpHandoff.submit(params[:id], params[:code])
      flash[:notice] = "OTP sent to the scraper. It will continue in a few seconds."
    else
      flash[:alert] = "That OTP request has expired or the code was empty. Wait for the next request."
    end
    redirect_to otp_requests_path
  end
end