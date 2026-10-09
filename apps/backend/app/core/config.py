from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(case_sensitive=True)
    APP_ENV: str = "development"
    LOG_LEVEL: str = "INFO"
    CORS_ORIGINS_STORE: str = "https://shop.rfo.localhost"
    CORS_ORIGINS_STAFF: str = "https://admin.rfo.localhost"
    DATABASE_URL: str
    JWT_SECRET: str
    JWT_ACCESS_TTL_MINUTES: int = 15
    JWT_REFRESH_TTL_DAYS: int = 14
    AI_PROVIDER: str = ""
    AI_ENDPOINT: str = ""
    AI_TEXT_MODEL: str = ""
    AI_VISION_MODEL: str = ""
    AI_EMBED_MODEL: str = ""
    PAYMENT_PROVIDER: str = "stub"
    PAYMENT_WEBHOOK_SECRET: str = ""
    REDIS_URL: str = ""
    DATABASE_AI_STAFF_URL: str = ""

    @property
    def cors_origins(self) -> list[str]:
        out = []
        for v in (self.CORS_ORIGINS_STORE, self.CORS_ORIGINS_STAFF):
            out.extend(o.strip() for o in v.split(",") if o.strip())
        return out

    @property
    def is_prod(self) -> bool:
        return self.APP_ENV.lower() in ("production", "prod")

@lru_cache
def get_settings() -> Settings:
    return Settings()