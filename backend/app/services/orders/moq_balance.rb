module Orders
  # The MOQ check per part, as SASH does it: the Firm Qty of all the part's Firm / Order rows of an upload, less the Qty
  # already on vendor POs (Generate PO) = the balance still to order. A part needs MOQ when that balance is above zero
  # but below its MOQ (in sets, as order Qty counts sets). Used for the MOQ alerts of an upload (Comparison::MoqChecker)
  # and, live, on the Orders page (Below MOQ card, Low MOQ badge and filter).
  #
  #   Orders::MoqBalance.parts(batch_id)["JXAE23539"]   # firm 445, issued 415, balance 30, moq 100, need_moq? true
  class MoqBalance
    Part = Data.define(:part_number, :product, :rows, :firm, :issued, :moq) do
      def balance = firm - issued
      # A discontinued part is not ordered any more, so it never needs MOQ.
      def need_moq? = !moq.nil? && !product&.discontinued? && balance.positive? && balance < moq
    end

    # { part_number => Part } of one upload (rows in Ship Date order).
    def self.parts(batch_id)
      rows = OrderRow.where(upload_batch_id: batch_id, order_type: %w[Firm Order]).where.not(qty: nil).order(:ship_date, :source_row_number).to_a
      return {} if rows.empty?

      keys = rows.to_h { |r| [ r.id, VendorOrderPlacement.order_key(r) ] }
      products = Product.where(part_number: rows.map(&:part_number).uniq).index_by(&:part_number)
      placed = VendorOrderPlacement.where(order_key: keys.values).group(:order_key).sum(Arel.sql("COALESCE(allocated_qty, order_qty)"))
      rows.group_by(&:part_number).to_h do |part, list|
        product = products[part]
        [ part, Part.new(part_number: part, product: product, rows: list, firm: list.sum(&:qty), issued: list.sum { |r| placed[keys[r.id]].to_d },
                         moq: product && (product.moq_sets || product.moq)) ]
      end
    end

    # The MOQ and balance of a part that needs MOQ (what the Orders page shows of a Part).
    Need = Data.define(:moq, :balance)
    # Part of the cache key: raise it when Need changes, so results cached in the old shape are not read.
    CACHE_VERSION = 1

    # { batch_id => { part_number => Part } }: the parts that need MOQ in each of these uploads.
    def self.needing(batch_ids)
      batch_ids.compact.to_h { |id| [ id, parts(id).select { |_, part| part.need_moq? } ] }
    end

    # { batch_id => { part_number => Need } }: #needing for the Orders page, cached per upload (its rows never change),
    # the products' MOQ data and the Qty on vendor POs (the key holds a digest of each, so any change gives a new key).
    def self.needs(batch_ids)
      ids = batch_ids.compact
      return {} if ids.empty?

      products = Product.pick(Arel.sql("md5(COALESCE(string_agg(ROW(part_number, moq, moq_sets, discontinued)::text, ',' ORDER BY id), ''))"))
      placed = VendorOrderPlacement.pick(Arel.sql("md5(COALESCE(string_agg(ROW(order_key, order_qty, allocated_qty)::text, ',' ORDER BY id), ''))"))
      ids.to_h do |id|
        needs = Rails.cache.fetch([ "orders-moq-needs", CACHE_VERSION, id, products, placed ], expires_in: 1.day) do
          parts(id).select { |_, part| part.need_moq? }.transform_values { |part| Need.new(moq: part.moq, balance: part.balance) }
        end
        [ id, needs ]
      end
    end
  end
end
