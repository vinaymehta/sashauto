module Uploads
  class ProcessJob < ApplicationJob
    queue_as :uploads

    # Validation problems are not retried (they are recorded on the batch). Unexpected errors are
    # retried; the processor's transaction guarantees a failed attempt leaves nothing behind.
    retry_on StandardError, attempts: 3, wait: :polynomially_longer do |job, error|
      Uploads::Processor.mark_failed(job.arguments.first, error)
    end

    def perform(batch_id)
      Uploads::Processor.call(batch_id)
    end
  end
end
