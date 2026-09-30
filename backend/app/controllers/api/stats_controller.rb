module Api
  class StatsController < ApplicationController
    def show
      render json: Dashboard::Stats.call
    end
  end
end
