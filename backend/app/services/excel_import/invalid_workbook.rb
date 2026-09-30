module ExcelImport
  # A file-level problem that makes the whole workbook unusable (corrupt, wrong layout, too large).
  class InvalidWorkbook < StandardError
    attr_reader :code

    def initialize(code, message)
      @code = code
      super(message)
    end
  end
end
