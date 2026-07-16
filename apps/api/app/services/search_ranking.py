from app.schemas.music import SearchResult


class SearchRankingService:
    official_terms = ("official", "vevo", "topic")

    def score(self, result: SearchResult, query: str) -> float:
        score = 0.0
        haystack = " ".join(
            value.lower()
            for value in [result.title, result.artist or "", result.channel or ""]
        )
        query_terms = [term for term in query.lower().split() if term]

        if all(term in haystack for term in query_terms):
            score += 35
        if any(term in (result.channel or "").lower() for term in self.official_terms):
            score += 25
        if "official music video" in result.title.lower():
            score += 20
        if "topic" in (result.channel or "").lower():
            score += 18
        if result.duration and 90 <= result.duration <= 600:
            score += 15
        if result.thumbnail:
            score += 5
        if result.view_count:
            score += min(result.view_count / 1_000_000, 20)

        return round(score, 2)

    def rank(self, results: list[SearchResult], query: str) -> list[SearchResult]:
        ranked = [result.model_copy(update={"rank_score": self.score(result, query)}) for result in results]
        return sorted(ranked, key=lambda result: result.rank_score, reverse=True)
