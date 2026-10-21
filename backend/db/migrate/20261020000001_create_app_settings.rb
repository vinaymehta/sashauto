# Business settings edited on the Settings page (company details, Intimation Letter, notifications, portal, Slack,
# businesses). A value here wins over the same key in .env; blank or missing falls back to .env.
class CreateAppSettings < ActiveRecord::Migration[8.1]
  def change
    create_table :app_settings do |t|
      t.string :key, null: false
      t.text :value
      t.references :updated_by, foreign_key: { to_table: :users }
      t.timestamps
    end
    add_index :app_settings, :key, unique: true
  end
end
