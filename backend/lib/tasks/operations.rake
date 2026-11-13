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
    # Set from the command line by an operator, so no change is forced at first sign-in.
    user.assign_attributes(name: ENV.fetch("NAME", user.name || email), role: role, password: password, active: true,
                           must_change_password: false)
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
  desc "Send a test email through Resend. TO=you@company.com"
  task test: :environment do
    to = ENV["TO"].presence || abort("Usage: bin/rails mail:test TO=you@company.com")
    method = ActionMailer::Base.delivery_method
    ActionMailer::Base.mail(from: AppConfig.mail_from, to: to, subject: "Order Change Tracker test email",
                            body: "Email is configured correctly (delivery method: #{method}).").deliver_now
    puts method == :resend ? "Sent to #{to} via Resend." : "No RESEND_API_KEY is set, so the email was written to tmp/mails/ instead."
  rescue Resend::Error => e
    abort "Resend rejected the email: #{e.message}\nCheck RESEND_API_KEY and that RESEND_FROM uses your verified Resend domain."
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

namespace :products do
  desc "Fetch product images from shop.deere.com (Sidekiq job). LIMIT=20 for a test batch, PART=JXAL117012 for one part"
  task deere_images: :environment do
    DeereShopImagesJob.perform_later(ENV["LIMIT"].presence, ENV["PART"].presence)
    puts "Started: products without an image get the main image from shop.deere.com."
    puts "Follow it with: journalctl -u sashauto-sidekiq -f | grep deere_shop"
    puts "Failed products are reported to Bugsnag (DeereShopImages); parts not in the shop are listed when the run ends."
  end
end

namespace :dispatch do
  # The dispatched orders list imported twice, once from the old list (with invoice dates) and once from Book 38 (no
  # dates: dated the import day), stored each shipment twice on its Dispatched mark, so Shipped Qty was doubled. Drops
  # the copies: a line with the same invoice, Qty and order row as an earlier line of the mark. DRY=1 lists them.
  desc "Remove duplicate shipment lines of Dispatched marks (same invoice, Qty and order row). [DRY=1]"
  task dedupe_lines: :environment do
    dry = ENV["DRY"].present?
    marks = 0
    dropped = 0
    OrderDelivery.transaction do
      OrderDelivery.active.where(kind: "dispatched").where("jsonb_array_length(invoice_lines) > 1").find_each do |d|
        kept = d.invoice_lines.uniq { |l| l.values_at("invoice", "qty", "order_key") }
        next if kept.size == d.invoice_lines.size

        dups = d.invoice_lines.size - kept.size
        puts "#{dry ? 'WOULD FIX' : 'FIXED'}  #{d.part_number} PO #{d.po_number} ship #{d.ship_date}: #{dups} duplicate line(s) of " \
             "#{(d.invoice_lines - kept).map { |l| "#{l['invoice']} Qty #{l['qty']}" }.uniq.join(', ')}"
        marks += 1
        dropped += dups
        d.update!(invoice_lines: kept) unless dry
      end
      raise ActiveRecord::Rollback if dry
    end
    puts "#{dry ? 'Would fix' : 'Fixed'} #{marks} orders, #{dropped} duplicate lines dropped."
  end
end
