# One video per Help topic (Help page; the topics themselves are config/help_topics.yml). The file is an Active Storage
# attachment; admins upload, replace and remove it.
class CreateHelpVideos < ActiveRecord::Migration[8.1]
  def change
    create_table :help_videos do |t|
      t.string :topic, null: false
      t.string :title
      t.references :uploaded_by, foreign_key: { to_table: :users }
      t.timestamps
    end
    add_index :help_videos, :topic, unique: true
  end
end
