class AgeingMailer < ApplicationMailer
  MAX_ROWS_PER_BAND = 300
  BAND_TITLES = {
    "red" => "Red: 90 days or more since Firm Date", "yellow" => "Yellow: 60–89 days since Firm Date",
    "green" => "Green: 30–59 days since Firm Date"
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

  # {band => [rows]}: the upload's order rows in each age band on the digest date that are not fully shipped, most
  # urgent band first, earliest ship date first. @firm_dates: row id => Firm Date; @open / @shipped: row id => Qty still
  # to ship / Qty shipped (Ageing::OpenQty).
  def notified_bands
    batch = @digest.upload_batch
    open = Ageing::OpenQty.new(batch.id)
    @open = {}
    @shipped = {}
    bands = Ageing::Rules::BANDS.to_h do |band|
      rows = Ageing::Rules.in_bands(batch.order_rows, [ band ], @today).order(:ship_date, :po_number, :part_number).to_a
      rows = rows.select do |row|
        @shipped[row.id] = open.shipped(row)
        (@open[row.id] = open.open(row)).positive?
      end
      [ band, rows.first(MAX_ROWS_PER_BAND) ]
    end
    @firm_dates = Orders::FirmDates.for_rows(bands.values.flatten)
    bands
  end
end
