require "active_support/testing/time_helpers"

namespace :uploads do
  # Loads a folder of old order files (Supplier Requirements .xlsx) of one business as uploads, oldest first, each
  # fully processed before the next, as if uploaded on its own date: the date (and time, when given) in the file name,
  # e.g. "01.04.2026 - DTP.xlsx" (10:00 IST) or "SupplierRequirements_DTP_02-11-26_08-01.xlsx". No emails are sent.
  # A file the same as the business's last upload is skipped. Files dated before the business's latest upload stop
  # the run (they would be compared the wrong way round), unless FORCE=1. A file named for the other business is skipped.
  # DRY=1 lists what would be loaded.
  desc "Load old order files as uploads, oldest first, without emails. DIR=... BUSINESS=dtp|gmbh [EMAIL=admin] [DRY=1] [FORCE=1]"
  task backfill: :environment do
    # Each file is processed with the clock set to its own date (Rails' time travel), so its upload is dated then.
    clock = Object.new.extend(ActiveSupport::Testing::TimeHelpers)

    dir = ENV.fetch("DIR") { abort "DIR is required" }
    business = ENV.fetch("BUSINESS") { abort "BUSINESS is required (dtp or gmbh)" }.downcase
    abort "BUSINESS must be one of #{Business::KEYS.join(', ')}" unless Business::KEYS.include?(business)
    user = ENV["EMAIL"].present? ? User.find_by!(email: ENV["EMAIL"].strip.downcase) : User.active.admins.order(:id).first
    abort "No active admin to upload as (set EMAIL)" unless user
    zone = Time.find_zone!(AppConfig.ageing_time_zone)

    # [time, path] of each file, by the date (and time) in its name.
    files = Dir.glob(File.join(dir, "**", "*.xlsx")).filter_map do |path|
      name = File.basename(path)
      other = Business::KEYS.find { |key| key != business && name.match?(/\b#{key}\b/i) }
      next puts("SKIP  #{name}: named for #{other.upcase}") if other

      at = if (m = name.match(/(\d{2})\.(\d{2})\.(\d{4})/))
        zone.local(m[3].to_i, m[2].to_i, m[1].to_i, 10)
      elsif (m = name.match(/(\d{2})-(\d{2})-(\d{2})(?:_(\d{2})-(\d{2}))?/))
        zone.local(2000 + m[3].to_i, m[2].to_i, m[1].to_i, (m[4] || 10).to_i, m[5].to_i)
      end
      at ? [ at, path ] : (puts("SKIP  #{name}: no date in the name") || nil)
    end.sort_by { |at, path| [ at, File.basename(path) ] }
    abort "No dated .xlsx files in #{dir}" if files.empty?

    latest = UploadBatch.latest_completed(business)
    if latest && files.first[0] < latest.completed_at && ENV["FORCE"].blank?
      abort "#{business.upcase} already has an upload of #{latest.completed_at.in_time_zone(zone)} (#{latest.original_filename}), " \
            "after the first file (#{files.first[0]}). Load into a business without later uploads, or FORCE=1."
    end
    puts "#{files.size} #{business.upcase} files, #{files.first[0].to_date} .. #{files.last[0].to_date}, as #{user.email}#{' (dry run)' if ENV['DRY'].present?}"

    counts = Hash.new(0)
    files.each do |at, path|
      name = File.basename(path)
      sha256 = Digest::SHA256.file(path).hexdigest
      if UploadBatch.where(business: business).where.not(status: "failed").order(:id).last&.file_sha256 == sha256
        counts[:same] += 1
        puts "SAME  #{at.strftime('%d %b %Y %H:%M')}  #{name}"
        next
      end
      if ENV["DRY"].present?
        counts[:would] += 1
        puts "LOAD  #{at.strftime('%d %b %Y %H:%M')}  #{name}"
        next
      end

      started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
      batch = clock.travel_to(at) do
        Uploads::Processor.without_emails do
          File.open(path, "rb") do |io|
            file = ActionDispatch::Http::UploadedFile.new(tempfile: io, filename: name, type: Uploads::Intake::XLSX_CONTENT_TYPE)
            created = Uploads::Intake.call(file: file, user: user, business: business, enqueue: false)
            Uploads::Processor.call(created.id)
          end
        end
      end
      took = (Process.clock_gettime(Process::CLOCK_MONOTONIC) - started).round(1)
      if batch.status == "completed"
        counts[:loaded] += 1
        AuditLog.record("upload.received", user: user, subject: batch, filename: name, sha256: sha256, source: "backfill", business: business)
        puts "OK    #{at.strftime('%d %b %Y %H:%M')}  #{name}  ##{batch.id}  #{batch.row_count} rows  #{took}s"
      else
        counts[:failed] += 1
        puts "FAIL  #{at.strftime('%d %b %Y %H:%M')}  #{name}  ##{batch.id}  #{batch.error_message}"
      end
    rescue Uploads::Intake::Rejected => e
      counts[:failed] += 1
      puts "FAIL  #{name}: #{e.message}"
    end
    puts "Done: #{counts.map { |k, v| "#{k} #{v}" }.join(', ')}"
  end
end
