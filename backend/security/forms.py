from django import forms


class LoginForm(forms.Form):
    email = forms.EmailField(label="Correo autorizado", max_length=150, widget=forms.EmailInput(attrs={"autocomplete": "username", "autofocus": True}))
    password = forms.CharField(label="Contraseña", max_length=1024, strip=False, widget=forms.PasswordInput(attrs={"autocomplete": "current-password"}))

    def clean_email(self):
        return self.cleaned_data["email"].strip().lower()


class OTPForm(forms.Form):
    method = forms.ChoiceField(label="Método", choices=[("totp", "Aplicación de autenticación"), ("recovery", "Código de recuperación")])
    token = forms.CharField(label="Código de verificación", max_length=64, widget=forms.TextInput(attrs={"autocomplete": "one-time-code", "autofocus": True}))


class TOTPForm(forms.Form):
    token = forms.RegexField(label="Código de 6 dígitos", regex=r"^[0-9]{6}$", max_length=6, min_length=6, widget=forms.TextInput(attrs={"autocomplete": "one-time-code", "inputmode": "numeric", "pattern": "[0-9]{6}", "autofocus": True}), error_messages={"invalid": "Escribe los 6 dígitos de tu aplicación."})
