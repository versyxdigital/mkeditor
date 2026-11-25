# Publishing MKEditor's Google consent screen

Use the Google Cloud project that owns MKEditor's bundled **Desktop app** OAuth client. This is a maintainer task performed once for the application. Users subsequently authorize their own accounts; they do not register Google apps. Publishing the project and receiving verification are separate steps.

## Prepare the public information

1. Open [Google Cloud Console](https://console.cloud.google.com/) and select that project. Confirm **Google Drive API** is enabled.
2. Open **Google Auth Platform → Branding**. Set the app name to **MKEditor**, add the matching logo, a monitored support email and developer contacts.
3. Provide a public product homepage and privacy policy on a domain you can verify. The homepage must describe MKEditor and link to the policy. Verify ownership through [Google Search Console](https://search.google.com/search-console) with an account associated with the Cloud project. The existing [MKEditor website](https://versyxdigital.github.io/mkeditor/) can be used if its hosting domain can be verified; otherwise use a verified custom domain. A [GitHub repository](https://github.com/versyxdigital/mkeditor) is useful supporting material, but does not replace these requirements.
4. The policy must accurately describe access to Drive file contents and metadata, their use for editing, local credential encryption, disconnect/removal, retention and encrypted recovery of remote drafts and interrupted operations. Explain any user-controlled transfer of document contents to optional AI providers. Do not claim that data never leaves the device without accounting for those features. Review the actual final implementation before publishing the policy.
5. Complete **Verify Branding**, address any issues and **Publish branding** when approved. Branding must be published before requesting data-access verification.

See Google's [branding and domain requirements](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification) and [branding workflow](https://support.google.com/cloud/answer/15549049).

### Prepared privacy page

[The standalone privacy policy](../privacy.html) is prepared for **Versyx Digital**, with **privacy@versyx.digital** as the publisher-provided contact. It covers the current desktop/browser implementation, Google Drive, optional AI context sharing, local storage, update/hosting requests, external resources, support and deletion. The page is self-contained, with no scripts, remote fonts or analytics.

Before publication, review the commitments about support retention and data use, confirm the contact mailbox works, and update the date if necessary. Publish the file as `privacy.html` at the root of MKEditor's actual website output, and add a **Privacy policy** link to that site's homepage. For the existing website, the intended public address is `https://versyxdigital.github.io/mkeditor/privacy.html`. The website source/deployment is not included in this checkout; adding the file here does not publish that address. If the website moves to a custom domain, use the matching policy address instead.

Once deployed, check that the page opens publicly without authentication and enter its real URL under **Google Auth Platform → Branding → Privacy policy**. Verify the website domain and use the same link on the homepage. A repository file, a local path or a URL that has not been deployed is not the public policy URL. Publication remains a maintainer action; this draft does not establish Google's approval or a complete legal review.

## Declare and justify access

In **Data Access**, declare exactly the scopes requested by the release:

| Permission                                       | Usage                                                                                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `https://www.googleapis.com/auth/drive.readonly` | Default connection: browse folders, identify Markdown documents and read files chosen by the user.                             |
| `https://www.googleapis.com/auth/drive`          | Separate **Enable editing** consent: save chosen existing Markdown files and create Markdown files in chosen My Drive folders. |

Both are **restricted** scopes. The developer-only disposable-file verifier also requests `drive.file`; include this only if distributing that flow under the production project, or isolate development verification in its own project. Do not request unrelated scopes.

Suggested starting justification, to review against the release being submitted:

> MKEditor is an established open-source desktop Markdown editor. Its Google Drive integration lets users navigate their Drive folders within the editor and open the Markdown documents they choose. The initial connection requests read-only access. Users separately enable editing through a further Google consent flow before saving existing documents or creating Markdown files in a chosen folder. Existing-file saves use a server-enforced revision precondition to protect concurrent changes. Credentials are encrypted locally using the operating system's credential facilities. File requests go directly between the desktop application and Google Drive.

Explain why this workflow requires browsing arbitrary existing folders and why a per-file Picker workflow would not meet that requirement. Google may ask for narrower access or a product change: `drive.file` with Google Picker is the recommended alternative for per-file authorization. Being open source does not remove verification requirements. See [Drive scope classifications and permitted app categories](https://developers.google.com/workspace/drive/api/guides/api-specific-auth) and [minimum-scope guidance](https://support.google.com/cloud/answer/13807380).

Describe optional AI data flows separately and accurately. Google's restricted-scope review determines whether a security assessment is needed; do not assume a desktop exemption covers every optional third-party transfer. Its [security assessment requirements](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification) apply to relevant server access to restricted data.

## Record and submit

1. Finish the release's features and test them using a disposable account. Keep a separate development/testing project where practical.
2. Record MKEditor opening **Settings → Connections**, signing in through Google, and showing the complete consent screen **in English**. Demonstrate folder browsing and opening a Markdown file. If requesting editing access, also show **Enable editing**, its consent flow, saving and creating a file. The recording must show how every requested permission is used. Provide an accessible recording link; no account tokens or private documents should appear. See [Google's demo requirements](https://support.google.com/cloud/answer/13804565).
3. In **Audience**, select **External** and publish the app to **In production** when ready for review. This alone does not grant verified status.
4. Open **Verification Center → Prepare for verification**. Review the configuration, provide scope justifications and the recording, and submit.
5. Monitor the project owner/editor email accounts for Google's questions and respond there. Track branding and data-access approval separately in Verification Center. See the [official submission steps](https://support.google.com/cloud/answer/13461325).

While developing, keep your account in **Audience → Test users**. This permits testing without completing public verification; it does not make the app generally available. Restricted Drive access in Testing normally has short-lived refresh grants, so reauthorization may be necessary.

No Google Console publishing or verification submission was performed as part of implementing the integration.

## Prepared recording

The 23 November 2026 Windows walkthrough is saved locally at `out/google-review/MKEditor-Google-Verification-2026-11-23.mp4` (88.4 seconds). It uses the owner's remembered Chrome profile and real Google requests, with the production renderer and cloud service in an isolated, memory-only demo shell. It shows consent, browsing a disposable folder, saving an existing sample, creating a new file and the existing Google permission details. Both saved contents were independently read back from Drive.

Review the video before sharing: the account label and profile image are visible, while passwords, verification-code inputs and the address bar are excluded. The permission-detail still includes the earlier verifier's `drive.file` grant and labels that distinction. The file has not been uploaded or submitted. Publish an accessible recording link for the verification form after review; the local path is not a submission URL. Disposable folders from both takes remain in Drive for inspection.
