# Each business numbers its own upload versions (DTP V1, V2…; GMBH V1, V2…), so the version is unique per business,
# not across all uploads: the first GMBH upload (V1) failed against DTP's V1. The (business, version) index also
# serves lookups by business alone, so that index goes.
class ScopeUploadVersionsToBusiness < ActiveRecord::Migration[8.1]
  def change
    remove_index :upload_batches, :version_number, unique: true, name: "index_upload_batches_on_version_number"
    remove_index :upload_batches, :business, name: "index_upload_batches_on_business"
    add_index :upload_batches, %i[business version_number], unique: true, name: "index_upload_batches_on_business_and_version"
  end
end
