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
    fixed = 0
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
      # A SASH Inc invoice uploaded while the shipments were doubled took the doubled Qty as the order's Order Qty
      # (Invoices::Allocator: at least what was sent): set it again from the shipments as they are now.
      lines = OrderDelivery.active.where(kind: "dispatched").pluck(:invoice_lines).flatten.group_by { |l| l["order_key"] }
      InvoiceAllocation.active.where(invoices: { kind: "inc" }).includes(:order_row, :manual_order).find_each do |a|
        order = a.manual_order || a.order_row
        next unless order

        latest = order.is_a?(OrderRow) &&
                 OrderRow.where(upload_batch_id: UploadBatch.latest_completed(order.upload_batch.business)&.id, group_key: order.group_key,
                                po_line_number: order.po_line_number, ship_date: order.ship_date).where.not(qty: nil).first
        qty = (latest || order).qty.to_d
        listed = (lines[a.order_key] || []).sum(0.to_d) { |l| l["qty"].present? ? BigDecimal(l["qty"].to_s) : qty }
        india = InvoiceAllocation.active.where(invoices: { kind: "india" }, order_key: a.order_key)
        expected = [ qty, india.maximum(:order_qty) || 0.to_d, listed + india.sum(:qty) ].max
        next unless a.order_qty > expected

        puts "#{dry ? 'WOULD FIX' : 'FIXED'}  #{a.invoice.label} #{a.invoice.invoice_number} on #{a.part_number} PO #{a.po_number} ship #{a.ship_date}: " \
             "Order Qty #{a.order_qty.to_i} → #{expected.to_i}"
        # Allocations are append-only (InvoiceAllocation#readonly?); this one-off correction writes the column directly.
        InvoiceAllocation.where(id: a.id).update_all(order_qty: expected) unless dry
        fixed += 1
      end
      raise ActiveRecord::Rollback if dry
    end
    puts "#{dry ? 'Would fix' : 'Fixed'} #{marks} orders, #{dropped} duplicate lines dropped; #{fixed} SASH Inc invoice line(s) given the right Order Qty."
  end
end

namespace :dispatch do
  # Until 14 Nov 2026 the dispatched orders list put a shipment whose delivery Deere had dropped (received) on a later
  # order with the same Qty (e.g. a March shipment on a January 2027 order), or skipped it. This sets the list's marks
  # again: the Received / Dispatched marks the list made are removed (not those of orders also marked Inbound or
  # Outbound, listed) and FILES (the dispatched lists, oldest first: the old lists with invoice dates, then Book 38)
  # are imported again, each shipment on its own delivery. One transaction; DRY=1 shows the result and rolls back.
  desc "Set the dispatched orders list's marks again from FILES=a.xlsx,b.xlsx (oldest first). [EMAIL=admin] [DRY=1]"
  task rebuild: :environment do
    dry = ENV["DRY"].present?
    files = ENV.fetch("FILES") { abort "FILES is required (the dispatched list files, oldest first, comma-separated)" }
                .split(",").map(&:strip).reject(&:empty?)
    files.each { |f| abort "No such file: #{f}" unless File.file?(f) }
    user = ENV["EMAIL"].present? ? User.find_by!(email: ENV["EMAIL"].strip.downcase) : User.active.admins.order(:id).first
    note = Orders::DispatchImport::NOTE
    OrderDelivery.transaction do
      listed = OrderDelivery.active.where(kind: "dispatched").where("note LIKE ?", "#{note}%")
      before = listed.count
      kept = OrderDelivery.active.where(order_key: listed.select(:order_key), kind: %w[inbound outbound]).distinct.pluck(:order_key).to_set
      removed = 0
      listed.find_each do |d|
        next puts("KEPT  #{d.part_number} PO #{d.po_number} ship #{d.ship_date}: also marked Inbound / Outbound") if kept.include?(d.order_key)

        OrderDelivery.active.where(order_key: d.order_key).where(id: d.id).or(
          OrderDelivery.active.where(order_key: d.order_key, kind: "received", note: "Set by the dispatched orders list")
        ).find_each { |m| m.update!(removed_at: Time.current, removed_by: user) }
        removed += 1
      end
      puts "Removed the list's marks of #{removed} orders."
      files.each do |path|
        result = Orders::DispatchImport.call(path: path, user: user)
        puts "#{File.basename(path)}: #{result.rows} rows, #{result.orders_marked} orders marked, #{result.skipped.size} rows skipped"
        result.skipped.each { |s| puts "   skipped row #{s[:row]} #{s[:part_number]} PO #{s[:po_number]}: #{s[:reason].to_s.first(140)}" }
      end
      after = OrderDelivery.active.where(kind: "dispatched").where("note LIKE ?", "#{note}%")
      puts "List-made Dispatched marks: #{before} before → #{after.count} now."
      AuditLog.record("order.dispatched_list_rebuilt", user: user, files: files.map { |f| File.basename(f) }, removed: removed, via: "rake") unless dry
      raise ActiveRecord::Rollback if dry
    end
    puts dry ? "DRY run: nothing changed." : "Done."
  end
end

namespace :invoices do
  # SASH Inc invoices uploaded before the dispatched list's marks were set again (dispatch:rebuild) went to the orders
  # the list knew then. This removes every active SASH Inc invoice and uploads the PDFs in DIR again in file-name order
  # (EX/26-27/001 first), as EMAIL. Invoices that match nothing, or that are not SASH Inc invoices, are listed and not
  # saved. One transaction; DRY=1 shows the result and rolls back.
  desc "Remove all SASH Inc invoices and upload DIR's PDFs again, oldest first. EMAIL=... [DRY=1]"
  task reupload_inc: :environment do
    dry = ENV["DRY"].present?
    dir = ENV.fetch("DIR") { abort "DIR is required (the folder with the SASH Inc invoice PDFs)" }
    abort "No such folder: #{dir}" unless File.directory?(dir)
    user = User.find_by!(email: ENV.fetch("EMAIL") { abort "EMAIL is required (who the invoices are uploaded by)" }.strip.downcase)
    files = Dir.glob(File.join(dir, "*.pdf")).sort
    abort "No PDF in #{dir}" if files.empty?
    Invoice.transaction do
      old = Invoice.active.where(kind: "inc").order(:id).to_a
      old.each { |i| i.update!(removed_at: Time.current, removed_by: user) }
      puts "Removed #{old.size} SASH Inc invoices: #{old.map(&:invoice_number).join(', ')}"
      saved = unmatched = 0
      files.each do |path|
        name = File.basename(path)
        record, summary = Invoices::Import.new(path: path, filename: name, kind: "inc", view: "all", user: user).save
        lines = summary[:lines].select { |l| l[:unmatched_qty] }
        saved += 1
        unmatched += lines.sum { |l| l[:unmatched_qty].to_d }
        puts "SAVED     #{name}: #{record.invoice_number}, #{summary[:matched_qty]} of #{summary[:total_qty]} pcs matched" +
             lines.map { |l| "\n          unmatched #{l[:part_number]} PO #{l[:po_number]}: #{l[:unmatched_qty]} of #{l[:qty]} (#{l[:reason]})" }.join
      rescue Invoices::Import::Rejected => e
        puts "NOT SAVED #{name}: #{e.message.first(220)}"
      end
      puts "#{saved} of #{files.size} saved; #{unmatched.to_i} pcs unmatched."
      AuditLog.record("invoices.reuploaded", user: user, kind: "inc", removed: old.size, saved: saved, via: "rake") unless dry
      raise ActiveRecord::Rollback if dry
    end
    puts dry ? "DRY run: nothing changed." : "Done."
  end
end

namespace :purchases do
  # Records the open import issues again with the current rules (Purchase orders → Import issues): vendor PO list rows
  # first (e.g. Forecast rows, now recorded on their dispatched order), then Purchase Received rows (whose vendor PO may
  # now be there). A row whose vendor is still not in Vendors is added as a vendor with the file's name when
  # ADD_VENDORS=1 (as "Add as vendor"). Resolved issues are closed as "recorded".
  #   bin/rails purchases:retry_issues [BUSINESS=dtp] [ADD_VENDORS=1] [EMAIL=admin@…] [DRY=1]
  desc "Record the open purchase import issues again with the current rules"
  task retry_issues: :environment do
    dry = ENV["DRY"] == "1"
    user = ENV["EMAIL"].present? ? User.find_by!(email: ENV["EMAIL"]) : User.where(role: "admin", active: true).order(:id).first!
    issues = PurchaseIssue.where(status: "open").includes(:vendor_po_import)
    issues = issues.where(business: ENV["BUSINESS"]) if ENV["BUSINESS"].present?
    done = Hash.new(0)
    still = Hash.new(0)
    ActiveRecord::Base.transaction do
      issues.sort_by { |i| [ i.vendor_po_import.kind == "orders" ? 0 : 1, i.vendor_po_import_id, i.excel_row.to_i ] }.each do |issue|
        kind = issue.vendor_po_import.kind
        vendor = nil
        if issue.reason_kind == "vendor" && ENV["ADD_VENDORS"] == "1" && issue.row_data["vendor"].present?
          name = issue.row_data["vendor"].to_s.squish.first(200)
          vendor = Vendor.where("lower(name) = ?", name.downcase).first || Vendor.create!(name: name)
        elsif issue.reason_kind == "vendor"
          still[kind] += 1
          next
        end
        reason = if kind == "orders"
          VendorOrders::FileImport.new(nil, nil, issue.business, user).place_issue(issue, vendor)
        else
          VendorOrders::ReceivedImport.new(nil, nil, issue.business, user).receive_issue(issue, vendor)
        end
        if reason.nil?
          issue.close!("resolved", user: user, resolution: vendor ? "vendor_created" : "recorded")
          done[kind] += 1
          puts "#{issue.business} #{kind} row #{issue.excel_row}: recorded"
        else
          still[kind] += 1
          puts "#{issue.business} #{kind} row #{issue.excel_row}: still not recorded (#{reason})" if ENV["VERBOSE"] == "1"
        end
      end
      puts "Recorded: #{done.to_h} · still open: #{still.to_h}#{dry ? ' (DRY: rolled back)' : ''}"
      raise ActiveRecord::Rollback if dry
    end
  end
end
