Rails.application.routes.draw do
  get "up" => "rails/health#show", as: :rails_health_check
  # Sidekiq dashboard (password in .env, see config/initializers/sidekiq.rb)
  mount Sidekiq::Web => "/sidekiq" if defined?(Sidekiq::Web)
  resources :otp_requests, only: [ :index ], id: /[a-z0-9_]+/ do
    member do
      post :submit
    end
  end
  scope :api, module: :api, as: :api, defaults: { format: :json } do
    resource :session, only: %i[show create destroy] do
      patch :password
    end
    resources :users, only: %i[index create update destroy] do
      post :reset_password, on: :member
    end
    resource :dashboard, only: :show, controller: :dashboard
    resource :stats, only: :show, controller: :stats
    resource :activity, only: :show, controller: :activity do
      post :read
    end

    resources :uploads, only: %i[index show create] do
      get :history, on: :collection
      member do
        get :changes
        get :address_changes
        get :moq_alerts
        get "moq_alerts/export", action: :moq_alerts_export
        get :problems
        get :rows
        get :download
        post :retry_notification
      end
    end

    resources :orders, only: :index do
      get :history, on: :member
      resource :vendor_order, only: %i[show create], controller: :vendor_orders do
        post :preview
        post :preview_letter
      end
      resources :deliveries, only: :create, controller: :order_deliveries
      resources :merges, only: %i[create destroy], controller: :order_merges
      collection do
        get :summary
        get :by_po
        get :by_part
      end
    end
    resources :order_deliveries, only: :destroy do
      post :import, on: :collection
    end
    resources :manual_orders, only: %i[show create update destroy] do
      get :fields, on: :collection
    end
    resources :vendor_orders, only: :update do
      member do
        get :pdf
        get :letter
        get :email
        post :regenerate
      end
    end
    resources :vendors, only: %i[index show create update] do
      post :import, on: :collection
      resources :products, only: %i[index create update destroy], controller: :vendor_products
    end
    # Every vendor's parts with their "Available" tick, vendor-wise (Products page, Available parts tab).
    resources :available_parts, only: :index
    # Business settings (Admin Settings, admins).
    get "settings", to: "settings#index"
    patch "settings", to: "settings#update"
    # Deere portal sync: status, and "Run sync now" (Admin Settings → Deere portal).
    resource :portal_sync, only: %i[show create], controller: :portal_sync
    resources :products, only: %i[index create update] do
      get :vendors, on: :member
      # Photos of the part: upload (several files), view one, remove one.
      resources :images, only: %i[create show destroy], controller: :product_images
    end
    resources :import_issues, only: :index do
      member do
        post :resolve
        post :dismiss
        post :delete_part
        post :link_vendor
        post :create_vendor
      end
    end
    resources :product_conflicts, only: [] do
      post :resolve, on: :member
    end
  end
end
