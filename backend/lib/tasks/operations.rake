namespace :users do
  desc "Create or update a user. EMAIL=... NAME=... ROLE=admin|warehouse_manager (password is prompted)"
  task create: :environment do
    require "io/console"
    email = ENV.fetch("EMAIL") { abort "EMAIL is required" }
    role = ENV.fetch("ROLE", "warehouse_manager")
    password = ENV["PASSWORD"].presence || begin
      print "Password (min 12 characters): "
      $stdin.noecho(&:gets).to_s.chomp.tap { puts }
    end

    user = User.find_or_initialize_by(email: email.strip.downcase)
    user.assign_attributes(name: ENV.fetch("NAME", user.name || email), role: role, password: password, active: true)
    if user.save
      AuditLog.record(user.previously_new_record? ? "user.created" : "user.updated", subject: user, role: user.role, via: "rake")
      puts "#{user.previously_new_record? ? 'Created' : 'Updated'} #{user.role} #{user.email}"
    else
      abort user.errors.full_messages.to_sentence
    end
  end

  desc "Deactivate a user. EMAIL=..."
  task deactivate: :environment do
    user = User.find_by!(email: ENV.fetch("EMAIL").strip.downcase)
    user.update!(active: false)
    AuditLog.record("user.deactivated", subject: user, via: "rake")
    puts "Deactivated #{user.email}"
  end
end

namespace :uploads do
  desc "Re-enqueue uploads stuck in pending/processing (e.g. Redis was down). OLDER_THAN_MINUTES=15"
  task reenqueue_stale: :environment do
    cutoff = Integer(ENV.fetch("OLDER_THAN_MINUTES", 15)).minutes.ago
    UploadBatch.where(status: %w[pending processing]).where(updated_at: ...cutoff).find_each do |batch|
      Uploads::ProcessJob.perform_later(batch.id)
      puts "Re-enqueued upload batch #{batch.id}"
    end
  end
end

namespace :notifications do
  desc "Enqueue delivery for every pending or failed notification"
  task redeliver: :environment do
    Notification.undelivered.find_each do |notification|
      Notifications::DeliverJob.perform_later(notification.id)
      puts "Enqueued notification #{notification.id} (#{notification.status}, #{notification.attempts} attempts)"
    end
  end
end

namespace :mail do
  desc "Send a test email with the current mail settings. TO=you@company.com"
  task test: :environment do
    to = ENV["TO"].presence || abort("Usage: bin/rails mail:test TO=you@company.com")
    method = ActionMailer::Base.delivery_method
    ActionMailer::Base.mail(from: AppConfig.mail_from, to: to, subject: "Order Change Tracker test email",
                            body: "SMTP is configured correctly (delivery method: #{method}).").deliver_now
    puts case method
    when :resend then "Sent to #{to} via Resend."
    when :smtp then "Sent to #{to} via #{AppConfig.env('SMTP_ADDRESS')}."
    else "No RESEND_API_KEY or SMTP_ADDRESS is set, so the email was written to tmp/mails/ instead."
    end
  rescue Net::SMTPAuthenticationError => e
    abort "SMTP login failed: #{e.message.strip}\nFor Gmail, SMTP_PASSWORD must be a 16-character App Password, not your normal password."
  rescue Resend::Error => e
    abort "Resend rejected the email: #{e.message}\nCheck RESEND_API_KEY and that MAIL_FROM uses your verified Resend domain."
  rescue StandardError => e
    abort "Sending failed: #{e.class}: #{e.message}"
  end
end

namespace :orders do
  desc "Fill the display-only order columns of existing uploads from their stored original files (safe to re-run)"
  task backfill_details: :environment do
    fields = ExcelImport::OrderRowParser::DETAIL_TYPES.keys
    UploadBatch.completed.order(:version_number).find_each do |batch|
      pending = batch.order_snapshot_rows.where(details_loaded: false)
      next puts("#{batch.id}: already complete") unless pending.exists?

      result = batch.file.open do |file|
        abort "Checksum mismatch for upload #{batch.id}" unless Digest::SHA256.file(file.path).hexdigest == batch.file_sha256
        ExcelImport::OrderRowParser.new(ExcelImport::WorkbookReader.new(file.path)).call
      end
      by_key = result.rows.index_by { |row| row[:business_key_hash] }

      updated = 0
      OrderSnapshotRow.transaction do
        pending.find_each do |row|
          source = by_key[row.business_key_hash] or next
          OrderSnapshotRow.where(id: row.id, details_loaded: false)
                          .update_all(source.slice(*fields).merge(details_loaded: true))
          updated += 1
        end
      end
      puts "#{batch.id}: filled #{updated} rows"
    end
  end
end

namespace :ageing do
  desc "Send the order ageing email now. MODE=manual (new 30/60/90-day rows, default) or MODE=preview (test, marks nothing)"
  task digest: :environment do
    mode = ENV["MODE"] == "preview" ? "preview" : "manual"
    today = Time.find_zone!(AppConfig.ageing_time_zone).today
    result = Ageing::DigestBuilder.call(mode: mode, today: today)
    puts "#{mode} digest for #{today}: #{result.status} #{result.counts.inspect}"
  end
end

namespace :orders do
  desc "Store every Excel row (all source columns) for uploads imported before order rows existed"
  task backfill_rows: :environment do
    UploadBatch.completed.order(:version_number).find_each do |batch|
      next puts("#{batch.id}: already has order rows") if batch.order_rows.exists?

      result = batch.file.open do |file|
        abort "Checksum mismatch for upload #{batch.id}" unless Digest::SHA256.file(file.path).hexdigest == batch.file_sha256
        ExcelImport::OrderRowParser.new(ExcelImport::WorkbookReader.new(file.path)).call
      end
      Uploads::Processor.allocate.tap { |p| p.instance_variable_set(:@batch, batch) }.send(:insert_order_rows, result.all_rows)
      puts "#{batch.id}: stored #{batch.order_rows.count} rows (#{batch.order_rows.current_rows.count} current)"
    end
  end
end
