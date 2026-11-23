# The video of one Help topic (config/help_topics.yml, Help::Topics): a screen recording an admin uploads on the Help
# page. Served to signed-in users who can see the topic (Api::HelpController#video), never from a public link.
class HelpVideo < ApplicationRecord
  TYPES = %w[video/mp4 video/webm video/quicktime].freeze
  MAX_BYTES = 300.megabytes

  belongs_to :uploaded_by, class_name: "User", optional: true
  has_one_attached :file

  validates :topic, presence: true, uniqueness: true
end
