// Native "Sign in with Google" via the Credential Manager Google ID option.
// Returns the Google ID token (JWT) to the web layer, which posts it to
// /api/auth/google for verification. Requires an Android OAuth client registered
// for this package + signing SHA-1, and the web client id passed as serverClientId.
// Lives in the alarm package only because setup-android.mjs copies plugin .kt there.
package ca.persistent.app.alarm

import android.os.CancellationSignal
import androidx.credentials.CredentialManager
import androidx.credentials.CredentialManagerCallback
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetCredentialResponse
import androidx.credentials.exceptions.GetCredentialException
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import java.util.concurrent.Executors

@CapacitorPlugin(name = "GoogleAuth")
class GoogleAuthPlugin : Plugin() {

    private val executor = Executors.newSingleThreadExecutor()

    @PluginMethod
    fun signIn(call: PluginCall) {
        val serverClientId = call.getString("serverClientId") ?: run {
            call.reject("serverClientId required")
            return
        }
        val act = activity ?: run {
            call.reject("No activity")
            return
        }
        val option = GetGoogleIdOption.Builder()
            .setServerClientId(serverClientId)
            .setFilterByAuthorizedAccounts(false)
            .setAutoSelectEnabled(false)
            .build()
        val request = GetCredentialRequest(listOf(option))
        val manager = CredentialManager.create(act)
        manager.getCredentialAsync(
            act,
            request,
            CancellationSignal(),
            executor,
            object : CredentialManagerCallback<GetCredentialResponse, GetCredentialException> {
                override fun onResult(result: GetCredentialResponse) {
                    val cred = result.credential
                    if (cred is CustomCredential && cred.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
                        try {
                            val token = GoogleIdTokenCredential.createFrom(cred.data).idToken
                            call.resolve(JSObject().put("idToken", token))
                        } catch (e: Exception) {
                            call.reject(e.message ?: "Invalid Google credential", e)
                        }
                    } else {
                        call.reject("Unexpected credential type")
                    }
                }

                override fun onError(e: GetCredentialException) {
                    call.reject(e.message ?: "Google sign-in failed", e)
                }
            }
        )
    }
}
