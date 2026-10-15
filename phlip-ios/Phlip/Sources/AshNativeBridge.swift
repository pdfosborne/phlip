import Foundation
import UIKit
import WebKit

/**
 Join-only JS bridge mirroring the Android `AshNative` subset needed to join servers
 and run personal space. Hosting APIs are gated by `hostingAvailable() == false`.
 */
final class AshNativeBridge: NSObject, WKScriptMessageHandler {
    weak var webView: WKWebView?
    private let secrets = DeviceSecretsStore()

    private static let handlerName = "ashNative"
    private static let identityAlias = "identity_p256_jwk"

    func attach(to userContent: WKUserContentController) {
        userContent.add(self, name: Self.handlerName)

        // Prefetch identity into the injected script so the first sync getDeviceSecret is correct
        // (WKScriptMessageHandler cannot return synchronously to JS).
        let identity = secrets.get(alias: Self.identityAlias) ?? ""
        let identityJson = Self.jsonString(identity)

        let bootstrap = """
        (function() {
          if (window.AshNative) return;
          window.__ashSecretCache = window.__ashSecretCache || {};
          window.__ashSecretCache[\(Self.jsonString(Self.identityAlias))] = \(identityJson);
          window.__ashNativeCallbacks = {};
          function call(method, args) {
            return new Promise(function(resolve, reject) {
              var id = 'cb_' + Math.random().toString(36).slice(2);
              window.__ashNativeCallbacks[id] = { resolve: resolve, reject: reject };
              window.webkit.messageHandlers.ashNative.postMessage({
                id: id, method: method, args: args || []
              });
            });
          }
          window.AshNative = {
            hostingAvailable: function() { return false; },
            putDeviceSecret: function(alias, value) {
              window.__ashSecretCache[alias] = value;
              call('putDeviceSecret', [alias, value]);
              return true;
            },
            getDeviceSecret: function(alias) {
              if (Object.prototype.hasOwnProperty.call(window.__ashSecretCache, alias)) {
                return String(window.__ashSecretCache[alias] || '');
              }
              call('getDeviceSecret', [alias]).then(function(v) {
                window.__ashSecretCache[alias] = (v == null) ? '' : String(v);
              });
              return '';
            },
            removeDeviceSecret: function(alias) {
              delete window.__ashSecretCache[alias];
              call('removeDeviceSecret', [alias]);
              return true;
            },
            hideKeyboard: function() { call('hideKeyboard', []); },
            shareText: function(text) { call('shareText', [text]); },
            shareImage: function(b64, caption) { call('shareImage', [b64, caption || '']); },
            saveImage: function(b64) { call('saveImage', [b64]); },
            openCalendarIcs: function(ics, filename) { call('openCalendarIcs', [ics, filename || 'event.ics']); },
            readClipboardText: function() {
              return String(window.__ashClipboardCache || '');
            },
            openAppSettings: function(screen) {
              if (typeof openHostSettingsPanel === 'function') openHostSettingsPanel(screen || 'host');
            }
          };
          call('readClipboardText', []).then(function(v) {
            window.__ashClipboardCache = (v == null) ? '' : String(v);
          });
        })();
        """
        userContent.addUserScript(WKUserScript(
            source: bootstrap,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
    }

    private static func jsonString(_ s: String) -> String {
        let data = try? JSONSerialization.data(withJSONObject: s, options: [])
        return data.flatMap { String(data: $0, encoding: .utf8) } ?? "\"\""
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard message.name == Self.handlerName,
              let body = message.body as? [String: Any],
              let id = body["id"] as? String,
              let method = body["method"] as? String
        else { return }
        let args = body["args"] as? [Any] ?? []

        // Image payloads can be several megabytes. Decode them off-main, then
        // return to the main actor only for UIKit/Photos work and WebView reply.
        if method == "shareImage" || method == "saveImage" {
          let encoded = stringArg(args, 0)
          let caption = stringArg(args, 1)
          DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let image = Data(base64Encoded: encoded, options: .ignoreUnknownCharacters)
              .flatMap(UIImage.init(data:))
            DispatchQueue.main.async {
              guard let self else { return }
              if let image {
                if method == "shareImage" {
                  var items: [Any] = [image]
                  if !caption.isEmpty { items.append(caption) }
                  self.presentShare(items: items)
                } else {
                  UIImageWriteToSavedPhotosAlbum(image, nil, nil, nil)
                }
              }
              self.reply(id: id, value: image != nil)
            }
          }
          return
        }

        // Keychain calls can block on protected-data/keybag access. They do not
        // touch UIKit, so keep them off the message-handler/main thread.
        if method == "putDeviceSecret" || method == "getDeviceSecret" || method == "removeDeviceSecret" {
          let alias = stringArg(args, 0)
          let value = stringArg(args, 1)
          DispatchQueue.global(qos: .utility).async { [weak self] in
            guard let self else { return }
            let result: Any
            switch method {
            case "putDeviceSecret": result = self.secrets.put(alias: alias, value: value)
            case "getDeviceSecret": result = self.secrets.get(alias: alias) ?? ""
            default:
              self.secrets.remove(alias: alias)
              result = true
            }
            DispatchQueue.main.async { [weak self] in self?.reply(id: id, value: result) }
          }
          return
        }

        DispatchQueue.main.async {
            let result = self.dispatch(method: method, args: args)
            self.reply(id: id, value: result)
        }
    }

    private func dispatch(method: String, args: [Any]) -> Any {
        switch method {
        case "hostingAvailable":
            return false
        case "putDeviceSecret":
            let alias = stringArg(args, 0)
            let value = stringArg(args, 1)
            return secrets.put(alias: alias, value: value)
        case "getDeviceSecret":
            return secrets.get(alias: stringArg(args, 0)) ?? ""
        case "removeDeviceSecret":
            secrets.remove(alias: stringArg(args, 0))
            return true
        case "hideKeyboard":
            webView?.endEditing(true)
            return true
        case "shareText":
            presentShare(items: [stringArg(args, 0)])
            return true
        case "shareImage":
            if let data = Data(base64Encoded: stringArg(args, 0), options: .ignoreUnknownCharacters),
               let image = UIImage(data: data) {
                let caption = stringArg(args, 1)
                var items: [Any] = [image]
                if !caption.isEmpty { items.append(caption) }
                presentShare(items: items)
            }
            return true
        case "saveImage":
            if let data = Data(base64Encoded: stringArg(args, 0), options: .ignoreUnknownCharacters),
               let image = UIImage(data: data) {
                UIImageWriteToSavedPhotosAlbum(image, nil, nil, nil)
            }
            return true
        case "openCalendarIcs":
            presentCalendarIcs(ics: stringArg(args, 0), filename: stringArg(args, 1))
            return true
        case "readClipboardText":
            return UIPasteboard.general.string ?? ""
        default:
            return NSNull()
        }
    }

    private func stringArg(_ args: [Any], _ index: Int) -> String {
        guard index < args.count else { return "" }
        if let s = args[index] as? String { return s }
        return String(describing: args[index])
    }

    private static let maxIcsChars = 1_000_000

    private func icsFilename(_ name: String) -> String {
        let raw = (name as NSString).deletingPathExtension
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_"))
        let stem = String(raw.unicodeScalars.filter { allowed.contains($0) }).prefix(80)
        return "\(stem.isEmpty ? "event" : String(stem)).ics"
    }

    private func presentCalendarIcs(ics: String, filename: String) {
        guard !ics.isEmpty, ics.count <= Self.maxIcsChars else { return }
        let name = icsFilename(filename)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
        do {
            guard let data = ics.data(using: .utf8) else { return }
            try data.write(to: url, options: .atomic)
            presentShare(items: [url])
        } catch {}
    }

    private func presentShare(items: [Any]) {
        guard let webView, let scene = webView.window?.windowScene,
              let root = scene.windows.first(where: { $0.isKeyWindow })?.rootViewController
        else { return }
        let vc = UIActivityViewController(activityItems: items, applicationActivities: nil)
        if let pop = vc.popoverPresentationController {
            pop.sourceView = webView
            pop.sourceRect = CGRect(x: webView.bounds.midX, y: webView.bounds.midY, width: 1, height: 1)
        }
        root.present(vc, animated: true)
    }

    private func reply(id: String, value: Any) {
        guard let webView else { return }
        let box: [String: Any] = ["id": id, "value": value is NSNull ? NSNull() : value]
        guard let data = try? JSONSerialization.data(withJSONObject: box, options: []),
              let json = String(data: data, encoding: .utf8)
        else { return }
        let js = """
        (function(){
          var msg = \(json);
          var cb = window.__ashNativeCallbacks && window.__ashNativeCallbacks[msg.id];
          if (cb) { cb.resolve(msg.value); delete window.__ashNativeCallbacks[msg.id]; }
        })();
        """
        webView.evaluateJavaScript(js, completionHandler: nil)
    }
}
