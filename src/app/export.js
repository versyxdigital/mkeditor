export const cdn = {
    bootstrap: {
        css: {
            rel: 'stylesheet',
            href: 'https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/css/bootstrap.min.css',
            integrity: 'sha384-EVSTQN3/azprG1Anm3QDgpJLIm9Nao0Yz1ztcQTwFspd3yD65VohhpuuCOmLASjC',
            crossorigin: 'anonymous'
        },
        js: {
            src: 'https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/js/bootstrap.bundle.min.js',
            integrity: 'sha384-MrcW6ZMFYlzcLA8Nl+NtUVF0sA7MsXsP1UyJoMp4YLEuNSfAP+JcXn/tWtIaxVXM',
            crossorigin: 'anonymous'
        }
    },
    fontawesome: {
        css: {
            rel: 'stylesheet',
            href: 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.2/css/all.min.css',
            integrity: 'sha512-z3gLpd7yknf1YoNbCzqRKc4qyor8gaKU1qmn+CShxbuBusANI9QpRohGBreCFkKxLhei6S9CQXFEbbKuqLg0DA==',
            crossorigin: 'anonymous'
        },
        js: {
            src: 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.2/js/all.min.js',
            integrity: 'sha512-uKQ39gEGiyUJl4AI6L+ekBdGKpGw4xJ55+xyJG7YFlJokPNYegn9KwQ3P8A7aFQAUtUsAQHep+d/lrGqrbPIDQ==',
            crossorigin: 'anonymous'
        }
    }
};

export function generateExportHTML (content, { providers }) {
    const document = (new DOMParser()).parseFromString(
        '<div class="container py-5">' +
            content +
        '</div>',
        'text/html'
    );

    if (providers) {
        for (const provider of providers) {
            if (Object.prototype.hasOwnProperty.call(cdn, provider)) {
                const { css, js } = cdn[provider];

                const stylesheet = document.createElement('link');
                stylesheet.rel = css.rel;
                stylesheet.href = css.href;
                stylesheet.integrity = css.integrity;
                stylesheet.crossOrigin = css.crossorigin;
                document.head.appendChild(stylesheet);

                const script = document.createElement('script');
                script.src = js.src;
                script.integrity = js.integrity;
                script.crossOrigin = js.crossorigin;
                document.body.appendChild(script);
            }
        }
    }

    return document.documentElement.outerHTML;
}
