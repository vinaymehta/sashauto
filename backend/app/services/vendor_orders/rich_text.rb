require "nokogiri"

module VendorOrders
  # The purchase order wording edited in Admin Settings → Purchase Order (a WYSIWYG editor): a small HTML subset —
  # paragraphs, headings, numbered / bulleted lists, bold, italic, underline and highlight (a black bar: white text on
  # black) — read into blocks the PDF builders print with Prawn. Wording saved before the editor (plain text, one line
  # each: "* " = bold or a black bar, "(a) " = a point) is read as well (RichText.html).
  #
  #   blocks = RichText.blocks(AppConfig.po_terms, company: "SASH", terms_url: "")
  #   pdf.formatted_text(RichText.fragments(pdf, blocks.first, size: 8, t: ->(s) { s }))
  module RichText
    # kind: :paragraph, :heading or :item; marker: "1." / "•" (items), nil; runs: [{ text:, styles: [], highlight: }].
    Block = Data.define(:kind, :marker, :runs) do
      def text = runs.sum("") { |r| r[:text] }
      def highlighted? = runs.any? { |r| r[:highlight] && r[:text].strip.present? }
      def blank? = text.strip.empty?
    end

    STYLES = { "strong" => :bold, "b" => :bold, "em" => :italic, "i" => :italic, "u" => :underline, "s" => :strikethrough }.freeze

    module_function

    # The wording as HTML: saved HTML as it is; older plain text converted (`list`: its lines are a numbered list, "* "
    # = a black bar; otherwise paragraphs, "* " = bold).
    def html(text, list: false)
      value = text.to_s.strip
      return value if value.start_with?("<")

      lines = value.gsub("\\n", "\n").split("\n").map(&:strip).reject(&:empty?)
      if list
        items = lines.map { |l| l.start_with?("* ") ? "<li><p><mark><strong>#{esc(l.delete_prefix('* '))}</strong></mark></p></li>" : "<li><p>#{esc(l)}</p></li>" }
        "<ol>#{items.join}</ol>"
      else
        lines.map { |l| l.start_with?("* ") ? "<p><strong>#{esc(l.delete_prefix('* '))}</strong></p>" : "<p>#{esc(l)}</p>" }.join
      end
    end

    # The blocks of the wording, with {company} / {terms_url} filled in; a block with {terms_url} is left out while there
    # is none.
    def blocks(text, list: false, company: "", terms_url: "")
      fragment = Nokogiri::HTML5.fragment(html(text, list: list))
      out = []
      fragment.children.each { |node| collect(node, out) }
      out.filter_map do |block|
        next if block.blank?
        next if block.text.include?("{terms_url}") && terms_url.blank?

        runs = block.runs.map { |r| r.merge(text: r[:text].gsub("{company}", company.to_s).gsub("{terms_url}", terms_url.to_s)) }
        block.with(runs: runs)
      end
    end

    # Prawn formatted-text fragments of a block (`t`: makes the text printable). Highlighted text is white on a black
    # bar drawn behind it.
    def fragments(pdf, block, size:, t:, bold: false)
      bar = Bar.new(pdf)
      block.runs.map do |run|
        styles = run[:styles].dup
        styles |= [ :bold ] if bold || block.kind == :heading
        fragment = { text: t.call(run[:text]), styles: styles, size: size }
        fragment.merge!(color: "FFFFFF", callback: bar) if run[:highlight]
        fragment
      end
    end

    # Draws the black bar behind highlighted text.
    class Bar
      def initialize(pdf)
        @pdf = pdf
      end

      def render_behind(fragment)
        color = @pdf.fill_color
        @pdf.fill_color "000000"
        @pdf.fill_rectangle([ fragment.left - 1, fragment.top + 1 ], fragment.width + 2, fragment.height + 1)
        @pdf.fill_color color
      end
    end

    def collect(node, out)
      case node.name
      when "ol", "ul"
        number = (node["start"] || 1).to_i
        node.element_children.select { |li| li.name == "li" }.each do |li|
          out << Block.new(kind: :item, marker: node.name == "ol" ? "#{number}." : "•", runs: inline(li))
          number += 1
        end
      when "h1", "h2", "h3", "h4", "h5", "h6"
        out << Block.new(kind: :heading, marker: nil, runs: inline(node))
      when "p", "div", "li"
        out << Block.new(kind: :paragraph, marker: nil, runs: inline(node))
      when "text"
        out << Block.new(kind: :paragraph, marker: nil, runs: [ { text: node.text, styles: [], highlight: false } ]) if node.text.strip.present?
      end
    end

    # The text runs of a block, with the styles around them (paragraphs inside a list item become new lines).
    def inline(node, styles = [], highlight = false, runs = [])
      node.children.each do |child|
        if child.text?
          runs << { text: child.text, styles: styles, highlight: highlight } unless child.text.empty?
        elsif child.name == "br"
          runs << { text: "\n", styles: styles, highlight: highlight }
        else
          runs << { text: "\n", styles: styles, highlight: false } if child.name == "p" && runs.any?
          inline(child, (styles + [ STYLES[child.name] ]).compact.uniq, highlight || child.name == "mark", runs)
        end
      end
      runs
    end

    def esc(text) = ERB::Util.html_escape(text)
  end
end
