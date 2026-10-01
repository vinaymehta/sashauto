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
        get :address_changes
        get :moq_alerts
        get :problems
        get :rows
        get :download
        post :retry_notification
      end
    end

    resources :orders, only: :index do
      get :history, on: :member
      collection do
        get :by_po
        get :by_part
      end
    end
    resources :vendors, only: %i[index show create update destroy] do
      post :import, on: :collection
      resources :products, only: %i[index create update destroy], controller: :vendor_products
    end
    resources :products, only: %i[index create update]
    resources :product_conflicts, only: [] do
      post :resolve, on: :member
    end
  end
end
