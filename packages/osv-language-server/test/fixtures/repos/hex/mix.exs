defmodule Demo.MixProject do
  use Mix.Project

  # deps are listed below: {:commented, "~> 9.9"}
  def project do
    [
      app: :demo,
      version: "0.1.0",
      deps: deps()
    ]
  end

  defp deps do
    [
      {:plug, "~> 1.3.0"},
      {:jason, "~> 1.4", only: :test},
      {:ecto, ">= 3.0.0 and < 4.0.0", only: [:dev, :test], runtime: false},
      # {:ignored, "~> 1.0"},
      {:my_git, git: "https://github.com/acme/my_git.git", tag: "v1.0"},
      {:my_gh, "~> 1.0", github: "acme/my_gh"},
      {:my_path, path: "../my_path"},
      {:no_version, only: :dev},
      {:telemetry, "~> 1.0 or ~> 2.0"}
    ]
  end
end
