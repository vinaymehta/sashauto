class AgeingMailer < ApplicationMailer
  MAX_ROWS_PER_BAND = 300
  BAND_TITLES = { 90 => "90+ days since ship date", 60 => "60–89 days since ship date", 30 => "30–59 days since ship date" }.freeze
  BAND_COLORS = { 90 => [ "#fbe9e6", "#a8321f" ], 60 => [ "#fdf5d8", "#8a5a00" ], 30 => [ "#eaf6ee", "#17693f" ] }.freeze
  helper QuantityFormatHelper

  def digest
    @digest = params.fetch(:digest)
    @today = @digest.as_of
    @bands = notified_bands
    @url = "#{AppConfig.app_url}/orders"

    mail(to: @digest.recipients, subject: @digest.subject,
         options: { idempotency_key: "ageing-digest-#{@digest.id}" })
  end

  private

  # {threshold => [rows]}: the upload's current rows (latest Ship Date per PO + Part + Type) in each age band
  # on the digest date, oldest first. Digests from before ageing moved to uploads list their recorded rows.
  def notified_bands
    return recorded_bands if @digest.ageing_notifications.exists?

    rows = @digest.upload_batch.order_rows.current_rows
    Ageing::Rules::THRESHOLDS.reverse.to_h do |t|
      [ t, rows.where(ship_date: Ageing::Rules.ship_date_range(t, @today)).order(:ship_date, :po_number, :part_number)
               .limit(MAX_ROWS_PER_BAND).to_a ]
    end
  end

  def recorded_bands
    highest = @digest.ageing_notifications.group(:order_row_id).maximum(:threshold)
    rows = OrderRow.where(id: highest.keys).order(:ship_date, :po_number, :po_line_number).to_a
    Ageing::Rules::THRESHOLDS.reverse.to_h { |t| [ t, rows.select { |r| highest[r.id] == t } ] }
  end
end
