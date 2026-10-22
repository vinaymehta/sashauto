# PDFs (purchase orders, Intimation Letters) use Prawn's built-in Helvetica, which covers Windows-1252 (£, €, ¥); text
# is converted to it first (VendorOrders::PdfBuilder#t), so Prawn's warning about non-ASCII text is not needed.
Prawn::Fonts::AFM.hide_m17n_warning = true
