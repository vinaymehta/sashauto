module Dashboard
  # Builds the Dashboard figures of every view once after an upload, so the cached parts that only change with a new upload
  # (first prices, Deere receipt history, combined orders, current lines) are ready before anyone opens the Dashboard or
  # Orders. Without it the first person after an upload waits several seconds per view.
  class WarmCacheJob < ApplicationJob
    queue_as :default

    def perform
      # Several files uploaded together: only the last upload's job warms (the others' figures are replaced at once).
      return if UploadBatch.where(status: %w[pending processing]).exists?

      Business::VIEWS.each { |view| Dashboard::Stats.call(view) }
    end
  end
end
