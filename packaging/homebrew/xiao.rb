# Homebrew cask for Gitguy268/homebrew-tap Casks/xiao.rb. It installs the release's kit and
# runs its installer, which makes Xiao's own copy of the Zen that the zen cask installs.
cask "xiao" do
  version "0.6.0"
  sha256 "d5cab37a9ca9d0c026f66e3c9de477378d3755dcf436e97be8a4e0bc0f78a928"

  url "https://github.com/Gitguy268/xiao/releases/download/v#{version}/xiao-kit.zip"
  name "Xiao"
  desc "Calm, private browser built on Zen"
  homepage "https://github.com/Gitguy268/xiao"

  depends_on cask: "zen"

  stage_only true

  # Builds ~/Applications/Xiao.app from /Applications/Zen.app, with its own profile in
  # ~/Library/Application Support/xiao-kit. Zen itself is not changed.
  postflight do
    system_command "/bin/sh", args: ["#{staged_path}/xiao-kit/install.sh"], print_stdout: true
  end

  uninstall delete: "~/Applications/Xiao.app"

  zap trash: "~/Library/Application Support/xiao-kit"

  caveats <<~EOS
    Xiao is ~/Applications/Xiao.app, a copy of Zen with Xiao's code in it. It rebuilds itself
    when Zen updates and has its own signed updates.
    For Tor tabs or Xiao Search, run the installer again with options:
      sh ~/Library/Application\\ Support/xiao-kit/kit/install.sh --tor --search
  EOS
end
