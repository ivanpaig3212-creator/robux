const memoryCache = new Map();

const CACHE_MS = 60000;
const TIMEOUT_MS = 7000;

function getCache(key) {
    const item = memoryCache.get(key);

    if (!item) return null;

    if (Date.now() - item.time > CACHE_MS) {
        memoryCache.delete(key);
        return null;
    }

    return item.value;
}

function setCache(key, value) {
    memoryCache.set(key, {
        time: Date.now(),
        value
    });

    if (memoryCache.size > 200) {
        const first = memoryCache.keys().next().value;

        if (first) {
            memoryCache.delete(first);
        }
    }
}

async function fetchWithTimeout(
    url,
    options = {},
    timeout = TIMEOUT_MS
) {
    const controller = new AbortController();

    const timer = setTimeout(() => {
        controller.abort();
    }, timeout);

    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal
        });
    } finally {
        clearTimeout(timer);
    }
}

async function fetchRoblox(
    url,
    options = {},
    attempts = 3
) {
    let lastError = null;

    for (let attempt = 0; attempt < attempts; attempt++) {

        try {

            const response = await fetchWithTimeout(
                url,
                options
            );

            const text = await response.text();

            if (response.ok) {
                return {
                    ok: true,
                    status: response.status,
                    text
                };
            }

            const retryable =
                response.status === 408 ||
                response.status === 429 ||
                response.status === 500 ||
                response.status === 502 ||
                response.status === 503 ||
                response.status === 504;

            if (
                !retryable ||
                attempt === attempts - 1
            ) {
                return {
                    ok: false,
                    status: response.status,
                    text
                };
            }

            const retryAfter = Number(
                response.headers.get("retry-after")
            );

            const wait =
                Number.isFinite(retryAfter) &&
                retryAfter > 0
                    ? Math.min(
                        retryAfter * 1000,
                        5000
                    )
                    : Math.min(
                        500 * Math.pow(2, attempt),
                        4000
                    );

            await new Promise(resolve =>
                setTimeout(resolve, wait)
            );

        } catch (error) {

            lastError = error;

            if (attempt < attempts - 1) {

                await new Promise(resolve =>
                    setTimeout(
                        resolve,
                        500 * Math.pow(2, attempt)
                    )
                );
            }
        }
    }

    return {
        ok: false,
        status: 503,
        text: lastError
            ? lastError.message
            : "Roblox request failed"
    };
}

function json(res, status, data) {

    res.setHeader(
        "Content-Type",
        "application/json"
    );

    res.setHeader(
        "Cache-Control",
        "no-store, max-age=0"
    );

    return res.status(status).json(data);
}

export default async function handler(req, res) {

    try {

        const {
            action,
            keyword,
            userIds,
            userId
        } = req.query;


        /*
         * SEARCH / EXACT USERNAME LOOKUP
         */

        if (action === "search") {

            if (
                !keyword ||
                keyword.trim().length < 2
            ) {

                return json(res, 400, {
                    error: "Username is too short"
                });
            }

            const username = keyword.trim();

            const cacheKey =
                "lookup:" +
                username.toLowerCase();

            const cached = getCache(cacheKey);

            if (cached) {
                return json(
                    res,
                    200,
                    cached
                );
            }


            /*
             * FIRST:
             * Exact username lookup
             */

            const exactUrl =
                "https://users.roblox.com/v1/usernames/users";

            const exactResult =
                await fetchRoblox(
                    exactUrl,
                    {
                        method: "POST",

                        headers: {
                            "Content-Type":
                                "application/json",

                            "Accept":
                                "application/json"
                        },

                        body: JSON.stringify({
                            usernames: [
                                username
                            ],

                            excludeBannedUsers:
                                false
                        })
                    }
                );


            if (exactResult.ok) {

                try {

                    const data =
                        JSON.parse(
                            exactResult.text
                        );

                    const result = {
                        data:
                            data.data || []
                    };

                    setCache(
                        cacheKey,
                        result
                    );

                    return json(
                        res,
                        200,
                        result
                    );

                } catch (_) {

                    // Continue to keyword search
                }
            }


            /*
             * SECOND:
             * Keyword search fallback
             */

            const searchUrl =
                "https://users.roblox.com/v1/users/search" +
                "?keyword=" +
                encodeURIComponent(username) +
                "&limit=10";

            const searchResult =
                await fetchRoblox(
                    searchUrl,
                    {
                        headers: {
                            "Accept":
                                "application/json"
                        }
                    }
                );


            if (searchResult.ok) {

                try {

                    const data =
                        JSON.parse(
                            searchResult.text
                        );

                    const result = {
                        data:
                            data.data || []
                    };

                    setCache(
                        cacheKey,
                        result
                    );

                    return json(
                        res,
                        200,
                        result
                    );

                } catch (_) {}
            }


            /*
             * Roblox is temporarily unavailable
             */

            return json(res, 503, {
                error:
                    "Roblox is temporarily unavailable.",

                retryable: true
            });
        }


        /*
         * AVATAR
         */

        if (action === "avatar") {

            if (!userIds) {

                return json(res, 400, {
                    error:
                        "Missing userIds"
                });
            }

            const ids =
                userIds
                    .split(",")
                    .map(x => x.trim())
                    .filter(Boolean)
                    .slice(0, 20);


            if (!ids.length) {

                return json(res, 400, {
                    error:
                        "Invalid userIds"
                });
            }


            const cacheKey =
                "avatar:" +
                ids.join(",");

            const cached =
                getCache(cacheKey);

            if (cached) {

                return json(
                    res,
                    200,
                    cached
                );
            }


            const url =
                "https://thumbnails.roblox.com/v1/users/avatar-headshot" +
                "?userIds=" +
                encodeURIComponent(
                    ids.join(",")
                ) +
                "&size=150x150" +
                "&format=Png" +
                "&isCircular=false";


            const result =
                await fetchRoblox(
                    url,
                    {
                        headers: {
                            "Accept":
                                "application/json"
                        }
                    }
                );


            if (!result.ok) {

                return json(res, 503, {
                    error:
                        "Avatar service temporarily unavailable.",

                    retryable: true
                });
            }


            try {

                const data =
                    JSON.parse(
                        result.text
                    );

                setCache(
                    cacheKey,
                    data
                );

                return json(
                    res,
                    200,
                    data
                );

            } catch (_) {

                return json(res, 503, {
                    error:
                        "Invalid avatar response.",

                    retryable: true
                });
            }
        }


        /*
         * USER DETAILS
         */

        if (action === "details") {

            if (!userId) {

                return json(res, 400, {
                    error:
                        "Missing userId"
                });
            }

            const id =
                String(userId).trim();

            const cacheKey =
                "details:" + id;

            const cached =
                getCache(cacheKey);

            if (cached) {

                return json(
                    res,
                    200,
                    cached
                );
            }


            const url =
                "https://users.roblox.com/v1/users/" +
                encodeURIComponent(id);


            const result =
                await fetchRoblox(
                    url,
                    {
                        headers: {
                            "Accept":
                                "application/json"
                        }
                    }
                );


            if (!result.ok) {

                return json(res, 503, {
                    error:
                        "User details temporarily unavailable.",

                    retryable: true
                });
            }


            try {

                const data =
                    JSON.parse(
                        result.text
                    );

                setCache(
                    cacheKey,
                    data
                );

                return json(
                    res,
                    200,
                    data
                );

            } catch (_) {

                return json(res, 503, {
                    error:
                        "Invalid user details response.",

                    retryable: true
                });
            }
        }


        /*
         * INVALID ACTION
         */

        return json(res, 400, {
            error:
                "Invalid action"
        });

    } catch (error) {

        console.error(
            "Roblox API error:",
            error
        );

        return json(res, 503, {
            error:
                "Roblox is temporarily unavailable.",

            retryable: true
        });
    }
}
