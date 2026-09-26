import crypto from "crypto";

const REDIS_URL =
    process.env.KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL;

const REDIS_TOKEN =
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN;

const ADMIN_KEY =
    process.env.ADMIN_KEY;

const SESSION_SECRET =
    process.env.SITE_SESSION_SECRET;

const SESSION_COOKIE =
    "robux_admin_session";

const SESSION_SECONDS =
    60 * 60 * 8;


/*
 * ---------------------------------------------------------
 * Redis helper
 * ---------------------------------------------------------
 */

async function redis(command) {

    if (!REDIS_URL || !REDIS_TOKEN) {

        throw new Error(
            "Redis environment variables are missing."
        );
    }

    const response =
        await fetch(
            REDIS_URL,
            {
                method: "POST",

                headers: {
                    "Authorization":
                        `Bearer ${REDIS_TOKEN}`,

                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify(command)
            }
        );

    const data =
        await response
            .json()
            .catch(() => null);

    if (!response.ok) {

        throw new Error(
            data?.error ||
            "Redis request failed."
        );
    }

    return data?.result;
}


/*
 * ---------------------------------------------------------
 * Session signing
 * ---------------------------------------------------------
 */

function sign(value) {

    return crypto
        .createHmac(
            "sha256",
            SESSION_SECRET || ""
        )
        .update(value)
        .digest("hex");
}


function createSession() {

    const timestamp =
        String(Date.now());

    return (
        timestamp +
        "." +
        sign(timestamp)
    );
}


function verifySession(session) {

    if (
        !session ||
        !SESSION_SECRET
    ) {

        return false;
    }

    const parts =
        session.split(".");

    if (
        parts.length !== 2
    ) {

        return false;
    }

    const timestamp =
        parts[0];

    const signature =
        parts[1];

    const expected =
        sign(timestamp);

    if (
        signature.length !==
        expected.length
    ) {

        return false;
    }

    try {

        if (
            !crypto.timingSafeEqual(
                Buffer.from(signature),
                Buffer.from(expected)
            )
        ) {

            return false;
        }

    } catch (_) {

        return false;
    }

    const age =
        Date.now() -
        Number(timestamp);

    return (
        Number.isFinite(age) &&
        age >= 0 &&
        age <
            SESSION_SECONDS * 1000
    );
}


/*
 * ---------------------------------------------------------
 * Cookies
 * ---------------------------------------------------------
 */

function getCookie(
    req,
    name
) {

    const cookieHeader =
        req.headers.cookie || "";

    const cookies =
        cookieHeader
            .split(";")
            .map(
                x => x.trim()
            );

    for (
        const cookie of cookies
    ) {

        const index =
            cookie.indexOf("=");

        if (
            index === -1
        ) {

            continue;
        }

        const key =
            cookie.slice(
                0,
                index
            );

        const value =
            cookie.slice(
                index + 1
            );

        if (
            key === name
        ) {

            return decodeURIComponent(
                value
            );
        }
    }

    return null;
}


function setSessionCookie(
    res,
    session
) {

    res.setHeader(
        "Set-Cookie",

        `${SESSION_COOKIE}=${encodeURIComponent(session)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}`
    );
}


function clearSessionCookie(
    res
) {

    res.setHeader(
        "Set-Cookie",

        `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
    );
}


/*
 * ---------------------------------------------------------
 * JSON response
 * ---------------------------------------------------------
 */

function json(
    res,
    status,
    data
) {

    res.setHeader(
        "Content-Type",
        "application/json"
    );

    res.setHeader(
        "Cache-Control",
        "no-store"
    );

    return res
        .status(status)
        .json(data);
}


/*
 * ---------------------------------------------------------
 * Admin authentication
 * ---------------------------------------------------------
 */

function isAdmin(req) {

    const session =
        getCookie(
            req,
            SESSION_COOKIE
        );

    return verifySession(
        session
    );
}


/*
 * ---------------------------------------------------------
 * Generate unique key
 * ---------------------------------------------------------
 */

function generateKey() {

    const part1 =
        crypto
            .randomBytes(3)
            .toString("hex")
            .toUpperCase();

    const part2 =
        crypto
            .randomBytes(3)
            .toString("hex")
            .toUpperCase();

    const part3 =
        crypto
            .randomBytes(3)
            .toString("hex")
            .toUpperCase();

    const part4 =
        crypto
            .randomBytes(3)
            .toString("hex")
            .toUpperCase();

    return (
        "RBX-" +
        part1 +
        "-" +
        part2 +
        "-" +
        part3 +
        "-" +
        part4
    );
}


/*
 * ---------------------------------------------------------
 * Allowed access durations
 *
 * These are stored in milliseconds.
 * The timer starts ONLY when the key is redeemed.
 * ---------------------------------------------------------
 */

const ALLOWED_DURATIONS = {

    "1h":
        60 * 60 * 1000,

    "6h":
        6 * 60 * 60 * 1000,

    "1d":
        24 * 60 * 60 * 1000,

    "3d":
        3 * 24 * 60 * 60 * 1000,

    "7d":
        7 * 24 * 60 * 60 * 1000,

    "30d":
        30 * 24 * 60 * 60 * 1000
};


/*
 * ---------------------------------------------------------
 * Main API
 * ---------------------------------------------------------
 */

export default async function handler(
    req,
    res
) {

    try {

        if (
            req.method !== "POST"
        ) {

            return json(
                res,
                405,
                {
                    error:
                        "Method not allowed."
                }
            );
        }


        const body =
            typeof req.body === "string"
                ? JSON.parse(
                    req.body || "{}"
                )
                : (
                    req.body || {}
                );


        const action =
            body.action;


        /*
         * -------------------------------------------------
         * LOGIN
         * -------------------------------------------------
         */

        if (
            action === "login"
        ) {

            if (
                !ADMIN_KEY
            ) {

                return json(
                    res,
                    500,
                    {
                        error:
                            "ADMIN_KEY is not configured."
                    }
                );
            }


            if (
                !SESSION_SECRET
            ) {

                return json(
                    res,
                    500,
                    {
                        error:
                            "SITE_SESSION_SECRET is not configured."
                    }
                );
            }


            const suppliedKey =
                String(
                    body.key || ""
                ).trim();


            if (
                !suppliedKey ||
                suppliedKey.length !==
                    ADMIN_KEY.length
            ) {

                return json(
                    res,
                    401,
                    {
                        error:
                            "Invalid admin key."
                    }
                );
            }


            let valid = false;


            try {

                valid =
                    crypto.timingSafeEqual(
                        Buffer.from(
                            suppliedKey
                        ),

                        Buffer.from(
                            ADMIN_KEY
                        )
                    );

            } catch (_) {

                valid = false;
            }


            if (!valid) {

                return json(
                    res,
                    401,
                    {
                        error:
                            "Invalid admin key."
                    }
                );
            }


            const session =
                createSession();


            setSessionCookie(
                res,
                session
            );


            return json(
                res,
                200,
                {
                    success:
                        true
                }
            );
        }


        /*
         * -------------------------------------------------
         * EVERYTHING BELOW HERE
         * REQUIRES ADMIN LOGIN
         * -------------------------------------------------
         */

        if (
            !isAdmin(req)
        ) {

            clearSessionCookie(
                res
            );

            return json(
                res,
                401,
                {
                    error:
                        "Admin authentication required."
                }
            );
        }


        /*
         * -------------------------------------------------
         * GENERATE
         * -------------------------------------------------
         */

        if (
            action === "generate"
        ) {

            const duration =
                String(
                    body.duration || "7d"
                )
                .trim()
                .toLowerCase();


            if (
                !Object.prototype
                    .hasOwnProperty.call(
                        ALLOWED_DURATIONS,
                        duration
                    )
            ) {

                return json(
                    res,
                    400,
                    {
                        error:
                            "Invalid access duration."
                    }
                );
            }


            let key = null;


            for (
                let attempt = 0;
                attempt < 10;
                attempt++
            ) {

                const candidate =
                    generateKey();


                const record = {

                    key:
                        candidate,

                    status:
                        "unused",

                    duration:
                        duration,

                    durationMs:
                        ALLOWED_DURATIONS[
                            duration
                        ],

                    createdAt:
                        new Date()
                            .toISOString(),

                    usedAt:
                        null,

                    expiresAt:
                        null,

                    revokedAt:
                        null
                };


                const result =
                    await redis([
                        "SET",

                        `access:key:${candidate}`,

                        JSON.stringify(
                            record
                        ),

                        "NX"
                    ]);


                if (
                    result === "OK"
                ) {

                    await redis([
                        "SADD",

                        "access:keys",

                        candidate
                    ]);


                    key =
                        candidate;

                    break;
                }
            }


            if (!key) {

                return json(
                    res,
                    500,
                    {
                        error:
                            "Could not generate a unique key. Try again."
                    }
                );
            }


            return json(
                res,
                200,
                {
                    success:
                        true,

                    key,

                    duration
                }
            );
        }


        /*
         * -------------------------------------------------
         * LIST KEYS
         * -------------------------------------------------
         */

        if (
            action === "list"
        ) {

            const keyNames =
                await redis([
                    "SMEMBERS",
                    "access:keys"
                ]);


            if (
                !Array.isArray(
                    keyNames
                ) ||
                keyNames.length === 0
            ) {

                return json(
                    res,
                    200,
                    {
                        keys: []
                    }
                );
            }


            const redisKeys =
                keyNames.map(
                    key =>
                        `access:key:${key}`
                );


            const records =
                await redis([
                    "MGET",
                    ...redisKeys
                ]);


            const keys = [];


            for (
                let i = 0;
                i < keyNames.length;
                i++
            ) {

                const raw =
                    records?.[i];


                if (!raw) {

                    continue;
                }


                try {

                    const record =
                        typeof raw === "string"
                            ? JSON.parse(raw)
                            : raw;


                    keys.push({

                        key:
                            keyNames[i],

                        status:
                            record.status ||
                            "unused",

                        duration:
                            record.duration ||
                            "7d",

                        durationMs:
                            record.durationMs ||
                            null,

                        createdAt:
                            record.createdAt ||
                            null,

                        usedAt:
                            record.usedAt ||
                            null,

                        expiresAt:
                            record.expiresAt ||
                            null,

                        revokedAt:
                            record.revokedAt ||
                            null
                    });

                } catch (_) {}
            }


            keys.sort(
                (
                    a,
                    b
                ) =>
                    String(
                        b.createdAt || ""
                    ).localeCompare(
                        String(
                            a.createdAt || ""
                        )
                    )
            );


            return json(
                res,
                200,
                {
                    keys
                }
            );
        }


        /*
         * -------------------------------------------------
         * REVOKE KEY
         * -------------------------------------------------
         */

        if (
            action === "revoke"
        ) {

            const key =
                String(
                    body.key || ""
                )
                .trim()
                .toUpperCase();


            if (!key) {

                return json(
                    res,
                    400,
                    {
                        error:
                            "Key is required."
                    }
                );
            }


            const redisKey =
                `access:key:${key}`;


            const raw =
                await redis([
                    "GET",
                    redisKey
                ]);


            if (!raw) {

                return json(
                    res,
                    404,
                    {
                        error:
                            "Key not found."
                    }
                );
            }


            let record;


            try {

                record =
                    typeof raw === "string"
                        ? JSON.parse(raw)
                        : raw;

            } catch (_) {

                return json(
                    res,
                    500,
                    {
                        error:
                            "Invalid key record."
                    }
                );
            }


            if (
                record.status ===
                "revoked"
            ) {

                return json(
                    res,
                    400,
                    {
                        error:
                            "Key is already revoked."
                    }
                );
            }


            record.status =
                "revoked";

            record.revokedAt =
                new Date()
                    .toISOString();


            await redis([
                "SET",

                redisKey,

                JSON.stringify(
                    record
                )
            ]);


            return json(
                res,
                200,
                {
                    success:
                        true,

                    key,

                    status:
                        "revoked"
                }
            );
        }


        /*
         * -------------------------------------------------
         * LOGOUT
         * -------------------------------------------------
         */

        if (
            action === "logout"
        ) {

            clearSessionCookie(
                res
            );


            return json(
                res,
                200,
                {
                    success:
                        true
                }
            );
        }


        return json(
            res,
            400,
            {
                error:
                    "Invalid action."
            }
        );


    } catch (error) {

        console.error(
            "Keys API error:",
            error
        );


        return json(
            res,
            500,
            {
                error:
                    "Request failed."
            }
        );
    }
}
