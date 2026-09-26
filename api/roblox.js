async function fetchRoblox(url, attempts = 3) {
    let lastResponse = null;
    let lastError = null;

    for (let attempt = 0; attempt < attempts; attempt++) {
        try {
            const response = await fetch(url);

            lastResponse = response;

            // Success
            if (response.ok) {
                return response;
            }

            // Retry temporary Roblox/Vercel errors
            if (
                response.status === 429 ||
                response.status === 500 ||
                response.status === 502 ||
                response.status === 503 ||
                response.status === 504
            ) {
                const retryAfter = response.headers.get("retry-after");

                let waitTime = retryAfter
                    ? Number(retryAfter) * 1000
                    : 800 * (attempt + 1);

                if (!Number.isFinite(waitTime)) {
                    waitTime = 800 * (attempt + 1);
                }

                await new Promise(resolve =>
                    setTimeout(resolve, Math.min(waitTime, 5000))
                );

                continue;
            }

            // Don't retry permanent errors
            return response;

        } catch (error) {
            lastError = error;

            await new Promise(resolve =>
                setTimeout(resolve, 800 * (attempt + 1))
            );
        }
    }

    if (lastResponse) {
        return lastResponse;
    }

    throw lastError || new Error("Roblox request failed");
}


export default async function handler(req, res) {
    try {
        const {
            action,
            keyword,
            userIds,
            userId
        } = req.query;


        // ==========================================
        // SEARCH ROBLOX USERS
        // ==========================================

        if (action === "search") {

            if (!keyword || keyword.length < 2) {
                return res.status(400).json({
                    error: "Username is too short"
                });
            }

            const url =
                "https://users.roblox.com/v1/users/search" +
                "?keyword=" +
                encodeURIComponent(keyword) +
                "&limit=10";

            const response = await fetchRoblox(url);

            const text = await response.text();

            if (!response.ok) {
                console.error(
                    "Roblox search failed:",
                    response.status,
                    text
                );

                return res.status(response.status).send(text);
            }

            return res
                .status(200)
                .setHeader("Content-Type", "application/json")
                .send(text);
        }


        // ==========================================
        // GET ROBLOX AVATAR
        // ==========================================

        if (action === "avatar") {

            if (!userIds) {
                return res.status(400).json({
                    error: "Missing userIds"
                });
            }

            const url =
                "https://thumbnails.roblox.com/v1/users/avatar-headshot" +
                "?userIds=" +
                encodeURIComponent(userIds) +
                "&size=150x150" +
                "&format=Png" +
                "&isCircular=false";

            const response = await fetchRoblox(url);

            const text = await response.text();

            if (!response.ok) {
                console.error(
                    "Roblox avatar failed:",
                    response.status,
                    text
                );

                return res.status(response.status).send(text);
            }

            return res
                .status(200)
                .setHeader("Content-Type", "application/json")
                .send(text);
        }


        // ==========================================
        // GET ROBLOX USER DETAILS
        // ==========================================

        if (action === "details") {

            if (!userId) {
                return res.status(400).json({
                    error: "Missing userId"
                });
            }

            const url =
                "https://users.roblox.com/v1/users/" +
                encodeURIComponent(userId);

            const response = await fetchRoblox(url);

            const text = await response.text();

            if (!response.ok) {
                console.error(
                    "Roblox details failed:",
                    response.status,
                    text
                );

                return res.status(response.status).send(text);
            }

            return res
                .status(200)
                .setHeader("Content-Type", "application/json")
                .send(text);
        }


        // ==========================================
        // INVALID ACTION
        // ==========================================

        return res.status(400).json({
            error: "Invalid action"
        });

    } catch (error) {

        console.error(
            "Roblox API error:",
            error
        );

        return res.status(500).json({
            error: "Server failed to contact Roblox",
            details: error.message
        });
    }
}