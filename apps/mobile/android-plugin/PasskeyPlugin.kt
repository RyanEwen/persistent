// Bridges WebAuthn to Android's Credential Manager so passkeys work in the
// Capacitor WebView (which has no navigator.credentials). Takes the WebAuthn
// options JSON from the server and returns the credential response JSON, which
// the web layer posts back for verification. Requires a Digital Asset Links file
// at the RP origin (/.well-known/assetlinks.json) matching the app's signing
// cert. Lives in the alarm package only because setup-android.mjs copies every
// plugin .kt there.
package ca.persistent.app.alarm

import android.os.CancellationSignal
import androidx.credentials.CreateCredentialResponse
import androidx.credentials.CreatePublicKeyCredentialRequest
import androidx.credentials.CreatePublicKeyCredentialResponse
import androidx.credentials.CredentialManager
import androidx.credentials.CredentialManagerCallback
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetCredentialResponse
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PublicKeyCredential
import androidx.credentials.exceptions.CreateCredentialException
import androidx.credentials.exceptions.GetCredentialException
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.util.concurrent.Executors

@CapacitorPlugin(name = "Passkey")
class PasskeyPlugin : Plugin() {

    private val executor = Executors.newSingleThreadExecutor()

    @PluginMethod
    fun createPasskey(call: PluginCall) {
        val optionsJson = call.getString("options") ?: run {
            call.reject("options required")
            return
        }
        val act = activity ?: run {
            call.reject("No activity")
            return
        }
        val manager = CredentialManager.create(act)
        manager.createCredentialAsync(
            act,
            CreatePublicKeyCredentialRequest(optionsJson),
            CancellationSignal(),
            executor,
            object : CredentialManagerCallback<CreateCredentialResponse, CreateCredentialException> {
                override fun onResult(result: CreateCredentialResponse) {
                    val json = (result as? CreatePublicKeyCredentialResponse)?.registrationResponseJson
                    if (json != null) call.resolve(JSObject().put("response", json))
                    else call.reject("Unexpected passkey response")
                }

                override fun onError(e: CreateCredentialException) {
                    call.reject(e.message ?: "Passkey creation failed", e)
                }
            }
        )
    }

    @PluginMethod
    fun getPasskey(call: PluginCall) {
        val optionsJson = call.getString("options") ?: run {
            call.reject("options required")
            return
        }
        val act = activity ?: run {
            call.reject("No activity")
            return
        }
        val manager = CredentialManager.create(act)
        val request = GetCredentialRequest(listOf(GetPublicKeyCredentialOption(optionsJson)))
        manager.getCredentialAsync(
            act,
            request,
            CancellationSignal(),
            executor,
            object : CredentialManagerCallback<GetCredentialResponse, GetCredentialException> {
                override fun onResult(result: GetCredentialResponse) {
                    val json = (result.credential as? PublicKeyCredential)?.authenticationResponseJson
                    if (json != null) call.resolve(JSObject().put("response", json))
                    else call.reject("Unexpected passkey response")
                }

                override fun onError(e: GetCredentialException) {
                    call.reject(e.message ?: "Passkey sign-in failed", e)
                }
            }
        )
    }
}
