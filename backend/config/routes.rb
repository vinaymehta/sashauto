Rails.application.routes.draw do
  get "up" => "rails/health#show", as: :rails_health_check

  scope :api, module: :api, as: :api, defaults: { format: :json } do
    resource :session, only: %i[show create destroy]
    resource :dashboard, only: :show, controller: :dashboard
    resource :stats, only: :show, controller: :stats
    resource :activity, only: :show, controller: :activity do
      post :read
    end

    resources :uploads, only: %i[index show create] do
      member do
        get :changes
        get :problems
        get :rows
        get :download
        post :retry_notification
      end
    end

    resources :orders, only: :index
    resources :products, only: %i[index create update]
    resources :product_conflicts, only: [] do
      post :resolve, on: :member
    end
  end
end
