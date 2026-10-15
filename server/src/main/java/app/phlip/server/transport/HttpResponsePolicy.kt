package app.phlip.server

import fi.iki.elonen.NanoHTTPD

/** Shared origin-response hardening for the HTTP transport adapters. */
internal object HttpResponsePolicy {
    fun close(response: NanoHTTPD.Response): NanoHTTPD.Response {
        response.addHeader("Connection", "close")
        response.closeConnection(true)
        return response
    }

    fun cors(response: NanoHTTPD.Response): NanoHTTPD.Response {
        response.addHeader("Access-Control-Allow-Origin", "*")
        response.addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        response.addHeader(
            "Access-Control-Allow-Headers",
            "Content-Type, X-Ash-Pass, X-Ash-Token, X-Phlip-Edge",
        )
        return close(response)
    }

    fun browserSecurity(response: NanoHTTPD.Response): NanoHTTPD.Response {
        response.addHeader("X-Content-Type-Options", "nosniff")
        response.addHeader("Referrer-Policy", "no-referrer")
        response.addHeader("X-Frame-Options", "DENY")
        return response
    }
}
