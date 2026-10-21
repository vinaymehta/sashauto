module Api
  class StatsController < ApplicationController
    def show
      render json: Dashboard::Stats.call(current_business)
    end
  end
end
