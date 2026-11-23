require "prawn"

module Help
  # The PDF of one Help topic (Help::Topics): the same text as the Help page, for reading offline or printing.
  #
  #   Help::PdfBuilder.new(topic).render   # => PDF bytes
  class PdfBuilder
    NAVY = "1d2636"
    GREY = "6b7280"
    LINE = "c9ced6"
    LOGO = Rails.root.join("app/assets/images/sash-logo-email.png")

    def initialize(topic)
      @topic = topic
    end

    def render
      pdf = Prawn::Document.new(page_size: "A4", margin: [ 40, 40, 50, 40 ], info: { Title: "SASH Help - #{@topic[:title]}" })
      pdf.font "Helvetica", size: 10
      header(pdf)
      Array(@topic[:sections]).each { |section| section(pdf, section) }
      messages(pdf) if @topic[:messages].present?
      footer(pdf)
      pdf.render
    end

    private

    def header(pdf)
      pdf.image LOGO.to_s, height: 26 if File.exist?(LOGO)
      pdf.move_down 10
      pdf.fill_color GREY
      pdf.text clean("Help · #{@topic[:category]}"), size: 9
      pdf.fill_color NAVY
      pdf.text clean(@topic[:title]), size: 18, style: :bold
      pdf.fill_color "000000"
      if @topic[:summary].present?
        pdf.move_down 4
        pdf.text clean(@topic[:summary]), size: 11, leading: 2
      end
      pdf.move_down 8
      pdf.stroke_color LINE
      pdf.stroke_horizontal_rule
      pdf.move_down 10
    end

    def section(pdf, section)
      if section[:heading].present?
        pdf.move_down 6
        pdf.fill_color NAVY
        pdf.text clean(section[:heading]), size: 12.5, style: :bold
        pdf.fill_color "000000"
        pdf.move_down 4
      end
      pdf.text clean(section[:text]), leading: 2 if section[:text].present?
      list(pdf, section[:steps], numbered: true) if section[:steps].present?
      list(pdf, section[:bullets], numbered: false) if section[:bullets].present?
      table(pdf, section[:table]) if section[:table].present?
      pdf.move_down 6
    end

    # A list; a step can carry a screenshot (Help::Topics), printed below it.
    def list(pdf, items, numbered:)
      pdf.move_down 3
      items.each_with_index do |item, i|
        text, image = item.is_a?(Hash) ? [ item[:text], item[:image] ] : [ item, nil ]
        mark = numbered ? "#{i + 1}." : "•"
        pdf.float { pdf.text mark, size: 10 }
        pdf.indent(16) { pdf.text clean(text), leading: 2 }
        path = image && Topics::IMAGES.join("#{image}.jpg")
        if path && File.file?(path)
          pdf.move_down 4
          pdf.indent(16) { pdf.image path.to_s, fit: [ pdf.bounds.width - 16, 230 ] }
        end
        pdf.move_down 4
      end
    end

    # A table as a list: the first column in bold, the others after it (each row starts on its own line).
    def table(pdf, table)
      columns = Array(table[:columns])
      pdf.move_down 3
      Array(table[:rows]).each do |row|
        first, *rest = row.map { |c| clean(c.to_s) }
        pdf.text first, style: :bold, leading: 1
        details = rest.each_with_index.filter_map { |cell, i| next if cell.empty?; columns.size > 2 && columns[i + 1] ? "#{clean(columns[i + 1])}: #{cell}" : cell }
        pdf.indent(12) { pdf.text details.join("   ·   "), leading: 2 } if details.any?
        pdf.move_down 4
      end
    end

    def messages(pdf)
      pdf.move_down 6
      pdf.fill_color NAVY
      pdf.text "Messages you may see", size: 12.5, style: :bold
      pdf.fill_color "000000"
      table(pdf, { columns: [ "Message", "What it means" ], rows: @topic[:messages].map { |m| [ m[:message], m[:meaning] ] } })
    end

    def footer(pdf)
      pdf.repeat(:all) do
        pdf.bounding_box([ 0, -15 ], width: pdf.bounds.width, height: 15) do
          pdf.fill_color GREY
          pdf.text clean("SASH order tracker · Help · #{@topic[:title]}"), size: 8
          pdf.fill_color "000000"
        end
      end
      pdf.number_pages "<page> / <total>", at: [ pdf.bounds.right - 50, -15 ], width: 50, align: :right, size: 8, color: GREY
    end

    # The built-in PDF font has no arrows or rupee sign: written in letters.
    def clean(text)
      text.to_s.gsub("**", "").gsub("→", ">").gsub("₹", "Rs ").gsub("≥", ">=").gsub("≤", "<=").gsub("×", "x")
          .encode("Windows-1252", invalid: :replace, undef: :replace, replace: "?").encode("UTF-8")
    end
  end
end
