module Api
  # The Settings page (admins): business settings saved in the app instead of .env (AppSetting). Each value comes with
  # where it is from: "app" (saved here), "env" (.env) or "none". Secrets are never sent back, only whether they are set.
  class SettingsController < ApplicationController
    def index
      render json: { data: AppSetting::DEFINITIONS.map { |d| serialize(d) } }
    end

    # PATCH { settings: { KEY => value } }. A blank value clears the saved one (.env applies again); a secret left out
    # keeps its value.
    def update
      changes = params.require(:settings).permit(*AppSetting::KEYS).to_h
      AppSetting.transaction do
        changes.each do |key, value|
          value = value.to_s.strip
          record = AppSetting.find_or_initialize_by(key: key)
          next if record.value.to_s == value

          record.update!(value: value.presence, updated_by: current_user)
        end
      end
      Rails.cache.delete(AppSetting::CACHE_KEY)
      audit("settings.updated", keys: changes.keys)
      render json: { data: AppSetting::DEFINITIONS.map { |d| serialize(d) } }
    end

    private

    def serialize(definition)
      saved = AppSetting[definition.key]
      env = ENV[definition.key].presence
      secret = definition.kind == :secret
      { key: definition.key, label: definition.label, group: definition.group, kind: definition.kind, hint: definition.hint,
        options: definition.options, default_value: definition.default, source: saved ? "app" : env ? "env" : "none",
        value: secret ? nil : saved || "", env_value: secret ? nil : env, set: (saved || env).present? }
    end
  end
end
