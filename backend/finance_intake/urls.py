from django.urls import path

from .webhook import whatsapp_webhook

app_name = "finance_intake"
urlpatterns = [path("", whatsapp_webhook, name="webhook")]
