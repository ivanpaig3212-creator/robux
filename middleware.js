const SITE_SESSION_COOKIE = "site_access";
const ADMIN_SESSION_COOKIE = "admin_access";

const SESSION_SECRET =
    "SITE_SESSION_SECRET";


/*
 * ---------------------------------------------------------
 * Base64 helpers
 * ---------------------------------------------------------
 */

function b64(bytes) {

    let s = "";

    for (
        let i = 0;
        i < bytes.length;
        i += 0x8000
    ) {

        s += String.fromCharCode(
            ...bytes.subarray(
                i,
                i + 0x8000
            )
        );
    }

    return btoa(s)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}


function b64d(value) {

    const padded =
        value
            .replace(/-/g, "+")
            .replace(/_/g, "/")
            .padEnd(
                value.length +
                (4 - value.length % 4) % 4,
                "="
            );

    const s =
        atob(padded);

    const bytes =
        new Uint8Array(
            s.length
        );

    for (
        let i = 0;
        i < s.length;
        i++
    ) {

        bytes[i] =
            s.charCodeAt(i);
    }

    return bytes;
}


/*
 * ---------------------------------------------------------
 * Read cookie
 * ---------------------------------------------------------
 */

function cookie(
    request,
    name
) {

    const header =
        request.headers.get(
            "cookie"
        ) || "";


    const match =
        header.match(
            new RegExp(
                "(?:^|;\\s*)" +
                name +
                "=([^;]+)"
            )
        );


    return match
        ? decodeURIComponent(
            match[1]
        )
        : null;
}


/*
 * ---------------------------------------------------------
 * Create signature
 * ---------------------------------------------------------
 */

async function sig(
    payload
) {

    const secret =
        process.env[
            SESSION_SECRET
        ];


    if (!secret) {
        return null;
    }


    const data =
        new TextEncoder()
            .encode(
                secret +
                "|" +
                payload
            );


    return b64(
        new Uint8Array(
            await crypto.subtle.digest(
                "SHA-256",
                data
            )
        )
    );
}


/*
 * ---------------------------------------------------------
 * Redis helper
 * ---------------------------------------------------------
 */

async function redis(
    command
) {

    const url =
        process.env.KV_REST_API_URL ||
        process.env.UPSTASH_REDIS_REST_URL;


    const token =
        process.env.KV_REST_API_TOKEN ||
        process.env.UPSTASH_REDIS_REST_TOKEN;


    if (
        !url ||
        !token
    ) {

        return null;
    }


    const response =
        await fetch(
            url,
            {
                method: "POST",

                headers: {
                    "Authorization":
                        `Bearer ${token}`,

                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify(
                        command
                    )
            }
        );


    if (!response.ok) {
        return null;
    }


    const data =
        await response
            .json()
            .catch(
                () => null
            );


    return data?.result;
}


/*
 * ---------------------------------------------------------
 * Validate site session
 *
 * Returns:
 * {
 *   valid: true,
 *   key: "RBX-..."
 * }
 *
 * OR
 *
 * {
 *   valid: false
 * }
 * ---------------------------------------------------------
 */

async function validSiteSession(
    request
) {

    const token =
        cookie(
            request,
            SITE_SESSION_COOKIE
        );


    if (!token) {

        return {
            valid: false
        };
    }


    const parts =
        token.split(".");


    if (
        parts.length !== 2
    ) {

        return {
            valid: false
        };
    }


    try {

        /*
         * Decode payload
         */

        const payload =
            new TextDecoder()
                .decode(
                    b64d(
                        parts[0]
                    )
                );


        /*
         * Payload format:
         *
         * expiration.key
         */

        const separator =
            payload.indexOf(".");


        if (
            separator === -1
        ) {

            return {
                valid: false
            };
        }


        const expiration =
            Number(
                payload.slice(
                    0,
                    separator
                )
            );


        const key =
            payload.slice(
                separator + 1
            );


        if (
            !Number.isFinite(
                expiration
            ) ||
            expiration <=
                Date.now()
        ) {

            return {
                valid: false
            };
        }


        if (!key) {

            return {
                valid: false
            };
        }


        /*
         * Verify signature
         */

        const expected =
            await sig(
                payload
            );


        if (!expected) {

            return {
                valid: false
            };
        }


        const actualBytes =
            b64d(
                parts[1]
            );


        const expectedBytes =
            b64d(
                expected
            );


        if (
            actualBytes.length !==
            expectedBytes.length
        ) {

            return {
                valid: false
            };
        }


        let difference = 0;


        for (
            let i = 0;
            i < actualBytes.length;
            i++
        ) {

            difference |=
                actualBytes[i] ^
                expectedBytes[i];
        }


        if (
            difference !== 0
        ) {

            return {
                valid: false
            };
        }


        /*
         * -------------------------------------------------
         * IMPORTANT:
         *
         * Check the exact key in Redis.
         *
         * If admin revoked the key,
         * the session immediately becomes invalid.
         * -------------------------------------------------
         */

        const raw =
            await redis([
                "GET",
                `access:key:${key}`
            ]);


        if (!raw) {

            return {
                valid: false
            };
        }


        let record;


        try {

            record =
                typeof raw === "string"
                    ? JSON.parse(raw)
                    : raw;

        } catch (_) {

            return {
                valid: false
            };
        }


        /*
         * Only "used" keys are allowed.
         *
         * "revoked" = immediately blocked.
         */

        if (
            record.status !==
            "used"
        ) {

            return {
                valid: false
            };
        }


        return {
            valid: true,
            key
        };


    } catch (_) {

        return {
            valid: false
        };
    }
}


/*
 * ---------------------------------------------------------
 * Middleware
 * ---------------------------------------------------------
 */

export default async function middleware(
    request
) {

    const url =
        new URL(
            request.url
        );


    const path =
        url.pathname;


    /*
     * -----------------------------------------------------
     * PUBLIC ACCESS PAGES
     * -----------------------------------------------------
     */

    if (
        path === "/unlock.html" ||
        path === "/api/access" ||
        path === "/favicon.ico"
    ) {

        return;
    }


    /*
     * -----------------------------------------------------
     * ADMIN
     *
     * Keep these public to middleware because
     * api/keys performs its own admin authentication.
     * -----------------------------------------------------
     */

    if (
        path === "/admin.html" ||
        path === "/api/keys"
    ) {

        return;
    }


    /*
     * -----------------------------------------------------
     * ROBLOX API
     * -----------------------------------------------------
     */

    if (
        path.startsWith(
            "/api/roblox"
        )
    ) {

        const session =
            await validSiteSession(
                request
            );


        if (
            session.valid
        ) {

            return;
        }


        return new Response(
            JSON.stringify({
                error:
                    "Unauthorized"
            }),
            {
                status: 401,

                headers: {
                    "Content-Type":
                        "application/json",

                    "Cache-Control":
                        "no-store"
                }
            }
        );
    }


    /*
     * -----------------------------------------------------
     * NORMAL WEBSITE
     * -----------------------------------------------------
     */

    const session =
        await validSiteSession(
            request
        );


    if (
        session.valid
    ) {

        return;
    }


    /*
     * -----------------------------------------------------
     * NO ACCESS
     *
     * Send them back to unlock page.
     * -----------------------------------------------------
     */

    return Response.redirect(
        new URL(
            "/unlock.html",
            request.url
        ),
        302
    );
}
