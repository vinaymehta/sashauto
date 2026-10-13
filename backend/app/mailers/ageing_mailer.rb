class AgeingMailer < ApplicationMailer
  MAX_ROWS_PER_BAND = 300
  BAND_TITLES = {
    "red" => "Red: under 15 days to ship date, or overdue", "yellow" => "Yellow: 15–44 days to ship date",
    "green" => "Green: 45+ days to ship date"
  }.freeze
  BAND_COLORS = { "red" => [ "#fbe9e6", "#a8321f" ], "yellow" => [ "#fdf5d8", "#8a5a00" ], "green" => [ "#eaf6ee", "#17693f" ] }.freeze
  helper QuantityFormatHelper

  def digest
    @digest = params.fetch(:digest)
    @today = @digest.as_of
    @bands = notified_bands
    @url = "#{AppConfig.app_url}/orders"

    mail(to: @digest.recipients, subject: @digest.subject,
         options: { idempotency_key: "ageing-digest-#{@digest.id}-#{@digest.created_at.to_i}" })
  end

  private

  # {band => [rows]}: the upload's current rows (latest Ship Date per PO + Part + Type) in each age band on the
  # digest date, most urgent band first, earliest ship date first.
  def notified_bands
    rows = @digest.upload_batch.order_rows.current_rows
    Ageing::Rules::BANDS.to_h do |band|
      [ band, rows.where(ship_date: Ageing::Rules.ship_date_range(band, @today)).order(:ship_date, :po_number, :part_number)
                  .limit(MAX_ROWS_PER_BAND).to_a ]
    end
  end
end
